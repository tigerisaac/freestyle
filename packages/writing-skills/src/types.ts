/**
 * The shapes shared by the catalog, the loader, and the router.
 *
 * Everything here is data. The package deliberately exports no behaviour that
 * a vendored skill could reach: third-party content arrives as strings and
 * leaves as strings, and nothing in `vendor/` is ever executed, imported, or
 * resolved as a path. That is the whole trust boundary — see §6.7 of
 * `specs/remix-writing-skills.md`.
 */

/** Which broad kind of writing a skill serves. Drives routing and settings. */
export type SkillCategory =
  | "clarity"
  | "professional"
  | "creative"
  | "marketing"
  | "academic"
  | "long-form";

/** Where a vendored file came from, kept so every activation is traceable. */
export interface SkillProvenance {
  /** `owner/repo` on GitHub. */
  source: string;
  /** The exact commit the content was taken from. */
  commit: string;
  /** Path within the upstream repository. */
  path: string;
  /** SPDX identifier, verified against the repo's own LICENSE at import. */
  license: string;
  /** Copyright line carried from the upstream license. */
  copyright: string;
}

/**
 * One addressable chunk of a skill.
 *
 * Large upstream entry files are split into sections at import so that
 * `academic-writing` — 4,000 words, well past the whole per-request budget —
 * can contribute its argument section without dragging in its publication
 * policy. A small skill has exactly one section and loads whole.
 */
export interface SkillSection {
  /** Stable id: the heading slug, or "overview" for the lead material. */
  id: string;
  /** The heading as written upstream, for provenance display. */
  heading: string;
  text: string;
  words: number;
}

/** A separate upstream file a skill can pull in when a task needs it. */
export interface SkillResource {
  id: string;
  /** One line, from upstream where it says so, else derived from the heading. */
  summary: string;
  text: string;
  words: number;
  provenance: SkillProvenance;
}

/** A vendored skill, as the loader sees it. */
export interface WritingSkill {
  id: string;
  category: SkillCategory;
  /** Upstream's own `name:` frontmatter. */
  name: string;
  /** Upstream's own `description:` frontmatter — what the router reads. */
  description: string;
  /** The label the pill's capability chip shows. Ours, not upstream's. */
  chipLabel: string;
  sections: SkillSection[];
  resources: SkillResource[];
  provenance: SkillProvenance;
  /** sha256 of the skill's vendored bytes, part of the bundle hash. */
  hash: string;
}

/** The compact per-skill line the router and the model's catalog are built from. */
export interface CatalogEntry {
  id: string;
  category: SkillCategory;
  chipLabel: string;
  /** Compact and capped: the catalog is sent on every uncertain request. */
  summary: string;
  resourceIds: string[];
}

/** What the router decided, and how sure it was. */
export interface RouteDecision {
  skillId: string | null;
  /** 0–1. Above the pre-activation threshold the skill loads before the call. */
  confidence: number;
  /** A focused section to load with the overview for this exact route. */
  resourceId?: string;
  /** A distinct supporting skill, never a second overlapping editorial pass. */
  supportingSkillId?: string;
  /**
   * Everything that scored at all, best first.
   *
   * The router always computed this and used to discard all but the winner,
   * which left the unconfident path with nothing to narrow by — so it offered
   * the entire catalog, every time, including when nothing had matched. On a
   * short work email that meant spending a third of the prompt describing
   * `story-planning` and `genre-horror`. Keeping the ranking lets the caller
   * offer the few skills that are actually in the running.
   */
  candidates: { skillId: string; score: number }[];
  /** Which signals fired, for telemetry and for the chip's explanation. */
  reasons: string[];
}
