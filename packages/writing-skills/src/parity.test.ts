import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SKILL_LIST } from "./catalog.js";
import { BUNDLE_HASH } from "./loader.js";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

interface Lock {
  bundleHash: string;
  sources: {
    repo: string;
    commit: string;
    license: string;
    files: { path: string; hash: string }[];
  }[];
}

const lock: Lock = JSON.parse(
  readFileSync(join(PACKAGE_ROOT, "upstream-lock.json"), "utf8"),
);

/**
 * The lockfile is the claim; `vendor/` is the evidence.
 *
 * These check that they still agree — which is what makes a hand-edit to a
 * vendored file, or a bundle regenerated from something other than the pinned
 * commits, a failing test rather than a silent change to what the model is
 * told. §6.1 asks CI to fail on parity drift; this is that check, and the
 * cloud repo runs the identical file against its identical copy.
 */
describe("vendored bundle integrity", () => {
  it("matches the hash the lockfile recorded", () => {
    expect(BUNDLE_HASH).toBe(lock.bundleHash);
  });

  it("has vendored bytes matching every recorded hash", () => {
    for (const source of lock.sources) {
      for (const file of source.files) {
        const vendored = readFileSync(
          join(PACKAGE_ROOT, "vendor", source.repo, file.path),
          "utf8",
        );
        const actual = createHash("sha256")
          .update(vendored, "utf8")
          .digest("hex");
        expect(actual, `${source.repo}/${file.path}`).toBe(file.hash);
      }
    }
  });

  it("ships a licence beside every source", () => {
    for (const source of lock.sources) {
      const licence = readFileSync(
        join(PACKAGE_ROOT, "vendor", source.repo, "LICENSE"),
        "utf8",
      );
      expect(licence.length, source.repo).toBeGreaterThan(200);
      // The manifest's claim has to be visible in the shipped text, not just
      // asserted at import time by a script nobody re-runs.
      if (source.license === "MIT") {
        expect(licence, source.repo).toMatch(/MIT License/i);
      } else {
        expect(licence, source.repo).toMatch(/Apache License/i);
      }
    }
  });

  it("pins every source to a full commit sha", () => {
    for (const source of lock.sources) {
      expect(source.commit, source.repo).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it("ships no skill that the lockfile does not account for", () => {
    const pinned = new Set(lock.sources.map((s) => s.repo));
    for (const skill of SKILL_LIST) {
      expect(pinned, skill.id).toContain(skill.provenance.source);
    }
  });

  it("carries no executable third-party content", () => {
    // The importer rejects these at vendoring time. Re-checked here because
    // the rejection only ever runs on the machine that did the import.
    for (const source of lock.sources) {
      for (const file of source.files) {
        const text = readFileSync(
          join(PACKAGE_ROOT, "vendor", source.repo, file.path),
          "utf8",
        );
        expect(text, `${source.repo}/${file.path}`).not.toMatch(
          /^\s*```\s*(?:bash|sh|zsh|powershell)\b/m,
        );
        expect(text, `${source.repo}/${file.path}`).not.toMatch(
          /\]\(file:\/\//i,
        );
      }
    }
  });
});
