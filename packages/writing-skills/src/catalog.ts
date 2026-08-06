/**
 * The catalog: what the model is told exists, before anything is loaded.
 *
 * This is the first of the three disclosure levels in §6.2 — a line per skill,
 * never the skill itself. It is sent only when routing was not confident
 * enough to pre-activate, which is the minority of requests, and it has to
 * stay inside a few hundred tokens even then. So the summary is a short capped
 * excerpt of upstream's own description rather than a fresh paraphrase that
 * could drift from the guidance it represents.
 */

import { SKILLS } from "./generated/bundle.js";
import type { CatalogEntry, SkillCategory, WritingSkill } from "./types.js";

/** Every vendored skill, sorted by id. */
export const SKILL_LIST: readonly WritingSkill[] = SKILLS;

const BY_ID = new Map(SKILLS.map((skill) => [skill.id, skill]));

export function getSkill(id: string): WritingSkill | undefined {
  return BY_ID.get(id);
}

export function skillsInCategory(
  category: SkillCategory,
): readonly WritingSkill[] {
  return SKILLS.filter((skill) => skill.category === category);
}

/** Compact upstream description, capped — the catalog line must stay short. */
function compactSummary(text: string, limit = 180): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.length > limit
    ? `${trimmed.slice(0, limit - 1).trimEnd()}…`
    : trimmed;
}

export function catalogEntry(skill: WritingSkill): CatalogEntry {
  return {
    id: skill.id,
    category: skill.category,
    chipLabel: skill.chipLabel,
    summary: compactSummary(skill.description),
    resourceIds: skill.resources.map((r) => r.id),
  };
}

export function buildCatalog(
  enabled?: (skill: WritingSkill) => boolean,
): CatalogEntry[] {
  return SKILLS.filter((s) => enabled?.(s) ?? true).map(catalogEntry);
}

/**
 * The catalog as the model sees it.
 *
 * Rendered as terse lines rather than JSON: the model only ever needs to pick
 * an id out of it, and JSON punctuation would cost tokens for structure that
 * carries no meaning here.
 */
export function renderCatalog(entries: CatalogEntry[]): string {
  if (entries.length === 0) return "";
  const lines = entries.map((entry) => {
    const resources =
      entry.resourceIds.length > 0
        ? ` [resources: ${entry.resourceIds.join(", ")}]`
        : "";
    return `- ${entry.id} — ${entry.summary}${resources}`;
  });
  return `Available writing skills (activate at most one, plus at most one distinct supporting skill):\n${lines.join("\n")}`;
}
