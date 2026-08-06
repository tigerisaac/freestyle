/**
 * The importer: turns pinned upstream repositories into vendored data.
 *
 * Runs by hand, never at build or request time — `pnpm --filter
 * @freestyle-voice/writing-skills import` — because a dependency that updates
 * itself is a dependency nobody reviewed. It clones each source at its pinned
 * commit, copies exactly the files the manifest names, and emits three things:
 * `vendor/` (verbatim copies plus licenses), `upstream-lock.json` (hashes),
 * and `src/generated/bundle.ts` (the text, embedded).
 *
 * Embedded rather than read from disk at runtime because Freestyle Cloud runs
 * on Workers, where there is no filesystem. It also means the shipped bundle
 * is a build artifact both hosts can hash and compare — the parity check the
 * spec asks CI to enforce.
 *
 * The rejections below are the trust boundary. Reputable upstreams are still
 * untrusted dependencies: they can add a script, a remote include, or a
 * path escape between one commit and the next, and the importer is where
 * that stops rather than in a reviewer's attention.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ManifestSkill,
  type ManifestSource,
  UPSTREAM_SOURCES,
} from "../manifest.js";
import type {
  SkillProvenance,
  SkillResource,
  SkillSection,
  WritingSkill,
} from "../src/types.js";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR_ROOT = join(PACKAGE_ROOT, "vendor");

/**
 * Content that is never acceptable in vendored prose, whatever the source.
 *
 * Each pattern is a way for a skill to reach outside the bytes we reviewed:
 * a fetch at read time, a file outside the vendor root, a script the model
 * might be told to run. Upstream having none of these today is not a reason
 * to allow them tomorrow.
 */
const FORBIDDEN: { pattern: RegExp; why: string }[] = [
  {
    pattern: /^\s*(?:!\[[^\]]*\]|\[[^\]]*\])\((?:https?:)?\/\//m,
    why: "remote link used as a resource reference",
  },
  { pattern: /\]\(file:\/\//i, why: "file:// reference" },
  { pattern: /\]\(\s*\/(?!\/)/, why: "absolute path reference" },
  { pattern: /\]\((?:\.\.\/){2,}/, why: "path escaping the skill directory" },
  {
    pattern: /^\s*```\s*(?:bash|sh|zsh|powershell)\b/m,
    why: "executable shell block",
  },
];

/** Frontmatter keys that describe an agent runtime we do not adopt. */
const IGNORED_FRONTMATTER = new Set([
  "allowed-tools",
  "allowed_tools",
  "tools",
  "model",
  "hooks",
  "scripts",
  "command",
]);

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function words(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** Parse YAML frontmatter far enough for scalar metadata we retain. */
function parseFrontmatter(raw: string): {
  data: Record<string, string>;
  body: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) return { data: {}, body: raw };
  const data: Record<string, string> = {};
  const lines = match[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    if (IGNORED_FRONTMATTER.has(key)) continue;
    const value = kv[2].trim();
    if (/^[>|][+-]?$/.test(value)) {
      const folded = value.startsWith(">");
      const continuation: string[] = [];
      while (i + 1 < lines.length && /^\s/.test(lines[i + 1])) {
        continuation.push(lines[++i].trim());
      }
      data[key] = continuation.join(folded ? " " : "\n").trim();
      continue;
    }
    data[key] = value.replace(/^["']|["']$/g, "");
  }
  return { data, body: raw.slice(match[0].length) };
}

function reject(where: string, why: string): never {
  throw new Error(`refusing to vendor ${where}: ${why}`);
}

function audit(where: string, text: string): void {
  for (const { pattern, why } of FORBIDDEN) {
    if (pattern.test(text)) reject(where, why);
  }
}

/**
 * Split an entry file at `## ` headings.
 *
 * The lead material before the first heading becomes "overview" and is what a
 * routed skill contributes by default; the rest is addressable so a request
 * about argument structure does not also load publication policy.
 */
function sectionize(body: string, sectioned: boolean): SkillSection[] {
  if (!sectioned) {
    return [
      {
        id: "overview",
        heading: "Overview",
        text: body.trim(),
        words: words(body),
      },
    ];
  }

  const sections: SkillSection[] = [];
  const parts = body.split(/^## +(.+)$/m);
  const lead = parts[0].trim();
  if (lead) {
    sections.push({
      id: "overview",
      heading: "Overview",
      text: lead,
      words: words(lead),
    });
  }
  for (let i = 1; i < parts.length; i += 2) {
    const heading = parts[i].trim();
    const text = `## ${heading}\n\n${(parts[i + 1] ?? "").trim()}`.trim();
    sections.push({
      id: slug(heading),
      heading,
      text,
      words: words(text),
    });
  }
  return sections;
}

function slug(heading: string): string {
  return (
    heading
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "section"
  );
}

/** Clone one source at its pinned commit into a scratch directory. */
function checkout(source: ManifestSource, into: string): void {
  const dir = join(into, source.repo.replace("/", "__"));
  execFileSync("git", ["init", "--quiet", dir], { stdio: "pipe" });
  execFileSync(
    "git",
    ["remote", "add", "origin", `https://github.com/${source.repo}.git`],
    { cwd: dir, stdio: "pipe" },
  );
  execFileSync(
    "git",
    ["fetch", "--quiet", "--depth", "1", "origin", source.commit],
    {
      cwd: dir,
      stdio: "pipe",
    },
  );
  execFileSync("git", ["checkout", "--quiet", "FETCH_HEAD"], {
    cwd: dir,
    stdio: "pipe",
  });
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: dir,
    encoding: "utf8",
  }).trim();
  if (head !== source.commit) {
    reject(source.repo, `checked out ${head}, expected ${source.commit}`);
  }
}

/** Confirm the repo's own LICENSE says what the manifest claims. */
function verifyLicense(source: ManifestSource, repoDir: string): string {
  const path = join(repoDir, source.licensePath);
  if (!existsSync(path))
    reject(source.repo, "no LICENSE file at the pinned commit");
  const text = readFileSync(path, "utf8");
  const declares =
    source.license === "MIT"
      ? /\bMIT License\b/i.test(text)
      : source.license === "Apache-2.0"
        ? /Apache License[\s\S]{0,80}Version 2\.0/i.test(text)
        : false;
  if (!declares) {
    reject(source.repo, `LICENSE does not read as ${source.license}`);
  }
  // MIT texts name the holder on a `Copyright (c)` line. The Apache-2.0
  // template does not — its only copyright line is the unfilled
  // `Copyright [yyyy] [name of copyright owner]` placeholder in the appendix,
  // which must not be mistaken for an actual claim. When there is no real
  // line, credit the repository owner and point at the licence file.
  const claimed = /^\s*(Copyright \(c\)(?!\s*\[).*)$/m.exec(text)?.[1]?.trim();
  return claimed ?? `Copyright held by the ${source.repo} authors`;
}

function readVendored(
  repoDir: string,
  source: ManifestSource,
  path: string,
  copyright: string,
): { text: string; provenance: SkillProvenance } {
  const abs = join(repoDir, path);
  // Belt and braces against a manifest typo that walks out of the checkout.
  if (relative(repoDir, abs).startsWith("..")) {
    reject(path, "path escapes the checkout");
  }
  if (!existsSync(abs)) reject(path, "not present at the pinned commit");
  const text = readFileSync(abs, "utf8");
  audit(`${source.repo}:${path}`, text);
  return {
    text,
    provenance: {
      source: source.repo,
      commit: source.commit,
      path,
      license: source.license,
      copyright,
    },
  };
}

function importSkill(
  repoDir: string,
  source: ManifestSource,
  skill: ManifestSkill,
  copyright: string,
): { built: WritingSkill; files: { path: string; hash: string }[] } {
  const files: { path: string; hash: string }[] = [];

  const entry = readVendored(repoDir, source, skill.entry, copyright);
  files.push({ path: skill.entry, hash: sha256(entry.text) });
  const { data, body } = parseFrontmatter(entry.text);
  if (!data.name || !data.description) {
    reject(skill.entry, "missing name/description frontmatter");
  }

  const resources: SkillResource[] = (skill.resources ?? []).map((res) => {
    const file = readVendored(repoDir, source, res.path, copyright);
    files.push({ path: res.path, hash: sha256(file.text) });
    const stripped = parseFrontmatter(file.text).body.trim();
    return {
      id: res.id,
      summary: res.summary,
      text: stripped,
      words: words(stripped),
      provenance: file.provenance,
    };
  });

  // Vendor the verbatim bytes beside the licence, so the shipped copy can
  // always be diffed against upstream without a network round trip.
  for (const path of [
    skill.entry,
    ...(skill.resources ?? []).map((r) => r.path),
  ]) {
    const dest = join(VENDOR_ROOT, source.repo, path);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(join(repoDir, path), dest);
  }
  const licenseDest = join(VENDOR_ROOT, source.repo, "LICENSE");
  mkdirSync(dirname(licenseDest), { recursive: true });
  cpSync(join(repoDir, source.licensePath), licenseDest);

  const sections = sectionize(body, skill.sectioned);

  return {
    built: {
      id: skill.id,
      category: skill.category,
      name: data.name,
      description: data.description,
      chipLabel: skill.chipLabel,
      sections,
      resources,
      provenance: entry.provenance,
      hash: sha256([entry.text, ...resources.map((r) => r.text)].join(" ")),
    },
    files,
  };
}

function main(): void {
  const scratch = mkdtempSync(join(tmpdir(), "freestyle-skills-"));
  rmSync(VENDOR_ROOT, { recursive: true, force: true });
  mkdirSync(VENDOR_ROOT, { recursive: true });

  const skills: WritingSkill[] = [];
  const lock: Record<string, unknown> = { version: 1, sources: [] };

  try {
    for (const source of UPSTREAM_SOURCES) {
      process.stdout.write(
        `fetching ${source.repo}@${source.commit.slice(0, 8)}\n`,
      );
      checkout(source, scratch);
      const repoDir = join(scratch, source.repo.replace("/", "__"));
      const copyright = verifyLicense(source, repoDir);

      const sourceFiles: { path: string; hash: string }[] = [];
      for (const skill of source.skills) {
        const { built, files } = importSkill(repoDir, source, skill, copyright);
        skills.push(built);
        sourceFiles.push(...files);
        process.stdout.write(
          `  ${built.id}: ${built.sections.length} section(s), ` +
            `${built.resources.length} resource(s)\n`,
        );
      }

      (lock.sources as unknown[]).push({
        repo: source.repo,
        commit: source.commit,
        license: source.license,
        copyright,
        files: sourceFiles.sort((a, b) => a.path.localeCompare(b.path)),
      });
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  skills.sort((a, b) => a.id.localeCompare(b.id));
  // Include Freestyle's catalog metadata and resource ids as well as the
  // upstream bytes. A category/chip/resource change alters routing behaviour
  // even when the vendored prose itself did not change.
  const bundleHash = sha256(JSON.stringify(skills));
  lock.bundleHash = bundleHash;

  writeFileSync(
    join(PACKAGE_ROOT, "upstream-lock.json"),
    `${JSON.stringify(lock, null, 2)}\n`,
  );
  writeFileSync(
    join(PACKAGE_ROOT, "src/generated/bundle.ts"),
    renderBundle(skills, bundleHash),
  );
  writeFileSync(
    join(PACKAGE_ROOT, "THIRD_PARTY_NOTICES.md"),
    renderNotices(skills),
  );

  process.stdout.write(
    `\nbundle ${bundleHash.slice(0, 16)} · ${skills.length} skills\n`,
  );
}

function renderBundle(skills: WritingSkill[], bundleHash: string): string {
  return `// GENERATED by scripts/import-skills.ts — do not edit.
//
// Third-party writing skills, vendored at the commits pinned in
// ../../manifest.ts and hashed in ../../upstream-lock.json. Text is embedded
// rather than read from disk because Freestyle Cloud runs on Workers, which
// have no filesystem — and because a build artifact is something both hosts
// can hash and compare.
//
// Upstream prose is preserved verbatim. See THIRD_PARTY_NOTICES.md for
// per-skill attribution and licences.

import type { WritingSkill } from "../types.js";

/** Identifies this exact set of skill bytes. Cloud and BYOK must agree. */
export const BUNDLE_HASH = ${JSON.stringify(bundleHash)};

export const SKILLS: readonly WritingSkill[] = ${JSON.stringify(skills, null, 2)} as const;
`;
}

function renderNotices(skills: WritingSkill[]): string {
  const bySource = new Map<string, WritingSkill[]>();
  for (const skill of skills) {
    const list = bySource.get(skill.provenance.source) ?? [];
    list.push(skill);
    bySource.set(skill.provenance.source, list);
  }

  let out = `# Third-party notices

Freestyle Remix's writing skills are vendored from the repositories below at
the exact commits listed. The prose is theirs and is reproduced unmodified;
Freestyle adds only routing, loading, and the safety wrapper around it.

No third-party scripts are shipped or executed. Only the files named in
\`manifest.ts\` are included, and \`upstream-lock.json\` records a hash of each.

The vendored prose is **unmodified**. Freestyle splits it into addressable
sections for progressive loading and ignores upstream agent-runtime
frontmatter (\`allowed-tools\` and similar), but does not alter, paraphrase, or
add to the text itself. This satisfies the notice-and-changes obligations of
the Apache-2.0 sources as well as the MIT ones.

`;
  for (const [source, list] of [...bySource].sort()) {
    const first = list[0].provenance;
    out += `## ${source}\n\n`;
    out += `- Commit: \`${first.commit}\`\n`;
    out += `- Licence: ${first.license}\n`;
    out += `- ${first.copyright}\n`;
    out += `- Full licence text: \`vendor/${source}/LICENSE\`\n`;
    out += `- Skills used: ${list.map((s) => `\`${s.id}\``).join(", ")}\n\n`;
  }
  return out;
}

main();
