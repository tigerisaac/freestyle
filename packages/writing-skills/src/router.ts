/**
 * The router: which skill, decided before the model is called.
 *
 * §6.3's hard constraint is that the fast path spends no extra round trip, so
 * this cannot be a classifier — it is a scorer over signals already in hand by
 * the time the request is assembled. Confident results pre-activate a skill;
 * everything else falls back to sending the catalog and letting the main agent
 * choose with `activate_writing_skill`, which costs nothing extra because it
 * rides the call that was happening anyway.
 *
 * The precedence in §6.3 is the design, not a tie-breaker:
 *
 *     explicit user instruction
 *   > current selection/document evidence
 *   > active Remix thread
 *   > application context
 *   > defaults
 *
 * Application context sits near the bottom deliberately. Gmail is evidence of
 * an email task, not proof of one — people draft novels, essays, and grocery
 * lists in their mail client, and a router that treated the app as intent
 * would confidently apply business-email register to all of them.
 */

import { getSkill } from "./catalog.js";
import type { RouteDecision, SkillCategory } from "./types.js";

export interface RouteInput {
  /** What the user said or typed. The strongest signal by a wide margin. */
  instruction: string;
  /** Whether they highlighted something, and how much. */
  target: "selected" | "empty" | "unavailable";
  selectionWords?: number;
  /** Frontmost application name, if known. */
  appName?: string | null;
  /** Active browser tab URL, if the app is a browser. */
  url?: string | null;
  /** A skill already active in this thread — sticky until intent changes. */
  activeSkillId?: string | null;
  /** Categories the user has switched off in settings. */
  disabledCategories?: readonly SkillCategory[];
}

/** Above this, pre-activate without asking the model. */
export const PRE_ACTIVATE_CONFIDENCE = 0.6;

interface Rule {
  category: SkillCategory;
  skillId: string;
  /** Matched against the instruction. Weighted highest: it is what was asked. */
  instruction?: RegExp;
  /** Matched against app name / URL. Weak on its own, never decisive alone. */
  context?: RegExp;
  weight: number;
  /** Focused section/resource to load for a confident match. */
  resourceId?: string;
}

/**
 * The rule table.
 *
 * Deliberately narrow. A rule that fires often but wrongly is worse than no
 * rule: it spends the budget on the wrong advice and the user has to notice
 * and override it. Anything not confidently matched goes to the catalog,
 * where the model decides with the request in front of it.
 */
const RULES: Rule[] = [
  // --- Professional / email ---------------------------------------------
  {
    category: "professional",
    skillId: "professional-communication",
    instruction: /\b(email|e-mail|reply|respond|write back|follow[- ]up)\b/i,
    weight: 0.72,
    resourceId: "email-best-practices",
  },
  {
    category: "professional",
    skillId: "professional-communication",
    instruction:
      /\b(memo|slack|message (?:my|the|to)|colleague|client|manager|stakeholder|apolog(?:y|ise|ize)|decline|request|introduce myself|status update|meeting agenda)\b/i,
    weight: 0.7,
    resourceId: "core-frameworks",
  },
  {
    category: "professional",
    skillId: "professional-communication",
    context:
      /\b(mail|gmail|outlook|superhuman|spark|thunderbird|slack|teams)\b/i,
    weight: 0.25,
  },

  // --- Clarity ----------------------------------------------------------
  {
    category: "clarity",
    skillId: "writing-clearly-and-concisely",
    instruction:
      /\b(clear|clearer|clarity|concise|tighten|simplify|shorten|trim|wordy|verbose|readable|easier to (?:read|follow)|plain english|cut(?: the)? fluff|jargon)\b/i,
    weight: 0.7,
  },

  // --- Creative ---------------------------------------------------------
  {
    category: "creative",
    skillId: "creative-writing-modes",
    instruction:
      /(?:\b(?:draft|write|continue|rewrite|revise|polish|bridge|connect|alternate take)\b.{0,60}\b(?:scene|chapter|story|fiction|prose|dialogue|passage)\b|\bnext scene\b)/i,
    weight: 0.82,
    resourceId: "prose-modes",
  },
  {
    category: "creative",
    skillId: "story-planning",
    instruction:
      /(?:\b(?:brainstorm|ideas?|possibilities|what if)\b.{0,60}\b(?:story|novel|plot|character|world|scene)\b|\b(?:story|novel|plot|character|world|scene)\b.{0,60}\b(?:brainstorm|ideas?|possibilities)\b)/i,
    weight: 0.84,
    resourceId: "brainstorming",
  },
  {
    category: "creative",
    skillId: "story-planning",
    instruction:
      /(?:\b(?:outline|plan|beat sheet|structure|architect)\b.{0,60}\b(?:story|novel|chapter|scene|plot|arc)\b|\b(?:story|novel|chapter|scene|plot|arc)\b.{0,60}\b(?:outline|plan|beat sheet|structure)\b)/i,
    weight: 0.82,
    resourceId: "story-architecture",
  },
  {
    category: "creative",
    skillId: "story-planning",
    instruction:
      /\b(character (?:arc|development)|develop (?:the )?character)\b/i,
    weight: 0.86,
    resourceId: "character-development",
  },
  {
    category: "creative",
    skillId: "story-planning",
    instruction: /\b(worldbuild(?:ing)?|develop (?:the )?world)\b/i,
    weight: 0.86,
    resourceId: "worldbuilding",
  },
  {
    category: "creative",
    skillId: "story-review",
    instruction:
      /\b(critique|feedback|review|what'?s wrong with)\b.*\b(scene|chapter|story|draft|prose)\b/i,
    weight: 0.8,
    resourceId: "editorial-review",
  },
  {
    category: "creative",
    skillId: "story-review",
    instruction: /\bdevelopmental edit(?:ing)?\b/i,
    weight: 0.9,
    resourceId: "developmental-edit",
  },
  {
    category: "creative",
    skillId: "story-review",
    instruction: /\bline edit(?:ing)?\b/i,
    weight: 0.9,
    resourceId: "line-edit",
  },
  {
    category: "creative",
    skillId: "story-review",
    instruction: /\bcopyedit(?:ing)?\b/i,
    weight: 0.9,
    resourceId: "copyedit",
  },
  {
    category: "creative",
    skillId: "story-review",
    instruction: /\bproofread(?:ing)?\b/i,
    weight: 0.9,
    resourceId: "proofreading",
  },
  {
    category: "creative",
    skillId: "story-review",
    instruction:
      /\b(?:check|review|find|flag)\b.{0,40}\b(?:continuity|inconsisten(?:cy|cies)|canon conflict)\b/i,
    weight: 0.88,
    resourceId: "critique-continuity",
  },
  {
    category: "creative",
    skillId: "reader-sim",
    instruction:
      /\b(first[- ]time reader|reader simulation|reader reaction|read as (?:a|the)|where (?:you|a reader) (?:drift|lose interest)|felt experience)\b/i,
    weight: 0.88,
  },
  {
    category: "creative",
    skillId: "story-memory",
    instruction:
      /\b(?:extract|track|record|remember)\b.{0,50}\b(?:canon|timeline|story facts?|character state|reveals?|terminology)\b/i,
    weight: 0.84,
    resourceId: "fact-extraction",
  },
  {
    category: "creative",
    skillId: "story-memory",
    instruction: /\b(story bible|canon reference|continuity bible)\b/i,
    weight: 0.84,
    resourceId: "story-reference-writing",
  },
  ...["fantasy", "horror", "litfic", "mystery", "romance", "thriller"].map(
    (genre): Rule => ({
      category: "creative",
      skillId: "creative-writing-craft",
      instruction: new RegExp(
        `\\b${genre === "litfic" ? "lit(?:erary)?[ -]?fic(?:tion)?" : genre}\\b`,
        "i",
      ),
      weight: 0.68,
      resourceId: `genre-${genre}`,
    }),
  ),
  {
    category: "creative",
    skillId: "creative-writing-craft",
    instruction:
      /\b(analy[sz]e|match|emulate|capture|replicate)\b.{0,50}\b(style|voice|prose)\b/i,
    weight: 0.86,
    resourceId: "style-analysis",
  },
  {
    category: "creative",
    skillId: "creative-writing-craft",
    instruction:
      /\b(psychic distance|free indirect|point of view|pov|interiority|sensory grounding|subtext|prose rhythm|narrative voice)\b/i,
    weight: 0.82,
    resourceId: "prose-writing",
  },
  {
    category: "creative",
    skillId: "creative-writing-craft",
    instruction:
      /\b(dialogue|pacing|scene (?:entry|opening|ending|transition|construction)|connective tissue)\b/i,
    weight: 0.76,
    resourceId: "scene-construction",
  },
  {
    category: "creative",
    skillId: "writing-principles",
    instruction:
      /\b(feels? flat|over[- ]explain(?:ed|ing)?|trust the reader|reader reward|sounds? (?:like )?ai|ai[- ]written|generic prose)\b/i,
    weight: 0.82,
    resourceId: "failure-modes",
  },

  // --- Marketing --------------------------------------------------------
  // Requires explicit commercial intent per §5.1: routing general documents
  // here would apply persuasion defaults nobody asked for.
  {
    category: "marketing",
    skillId: "copywriting",
    instruction:
      /\b(landing page|headline|tagline|value prop(?:osition)?|cta|call to action|ad copy|marketing copy|sales page|conversion|campaign|pitch deck copy|product page)\b/i,
    weight: 0.8,
    resourceId: "copywriting-principles",
  },
  {
    category: "marketing",
    skillId: "copy-editing",
    instruction:
      /\b(punch(?:ier)?|more compelling|more persuasive|sell|hook)\b.*\b(copy|headline|page|cta)\b/i,
    weight: 0.75,
    resourceId: "the-seven-sweeps-framework",
  },

  // --- Academic ---------------------------------------------------------
  {
    category: "academic",
    skillId: "academic-writing",
    instruction:
      /\b(thesis|dissertation|abstract|literature review|citation|cite|references|peer review|methodology|hypothesis|research question|journal|paper|counterargument|argument)\b/i,
    weight: 0.7,
    resourceId: "writing-conventions",
  },

  // --- Long-form --------------------------------------------------------
  {
    category: "long-form",
    skillId: "long-form-content-frameworks",
    instruction:
      /\b(whitepaper|white paper|long[- ]form|guide|report|article|essay|blog post|case study)\b/i,
    weight: 0.65,
    resourceId: "structural-archetypes",
  },
  {
    category: "long-form",
    skillId: "long-form-content-frameworks",
    // An explicit large word count is a structural request whatever the topic.
    instruction: /\b([1-9]\d{3,})\s*(?:-|\s)?words?\b/i,
    weight: 0.75,
    resourceId: "structural-archetypes",
  },
];

/**
 * Skills that can pair usefully — a distinct supporting function, per §6.2.
 *
 * Never two overlapping editorial passes. Clarity supports drafting skills
 * because it is about sentences rather than about form; it is deliberately
 * absent for creative work, where "concise and plain" would flatten a voice
 * the author chose (this is open decision §11.1, resolved conservatively:
 * creative prose gets clarity only when the user asks for it). A support skill
 * is activated only when its own routing rule also matched; being a useful pair
 * is not enough reason to spend its prompt budget on every request.
 */
const SUPPORT: Partial<Record<SkillCategory, string>> = {
  professional: "writing-clearly-and-concisely",
  academic: "writing-clearly-and-concisely",
  "long-form": "writing-clearly-and-concisely",
  marketing: "copy-editing",
};

export function routeWritingSkill(input: RouteInput): RouteDecision {
  const disabled = new Set(input.disabledCategories ?? []);
  const instruction = input.instruction.trim();
  const context = `${input.appName ?? ""} ${input.url ?? ""}`;

  const scores = new Map<
    string,
    { score: number; category: SkillCategory; resourceId?: string }
  >();
  const reasons: string[] = [];

  for (const rule of RULES) {
    if (disabled.has(rule.category)) continue;
    let hit = false;
    if (rule.instruction?.test(instruction)) {
      hit = true;
      reasons.push(`instruction→${rule.skillId}`);
    } else if (rule.context?.test(context)) {
      hit = true;
      reasons.push(`app→${rule.skillId}`);
    }
    if (!hit) continue;
    const prior = scores.get(rule.skillId);
    scores.set(rule.skillId, {
      // Signals accumulate but saturate: two weak hints should not add up to
      // the certainty of one explicit request.
      score: Math.min(
        0.95,
        (prior?.score ?? 0) + rule.weight * (prior ? 0.4 : 1),
      ),
      category: rule.category,
      resourceId: rule.resourceId ?? prior?.resourceId,
    });
  }

  // A thread that already settled on a skill keeps it unless the new
  // instruction points somewhere else clearly. Re-routing mid-conversation is
  // how a chapter turns into a business memo halfway down.
  const activeCategory = input.activeSkillId
    ? categoryOf(input.activeSkillId)
    : null;
  if (input.activeSkillId && activeCategory && !disabled.has(activeCategory)) {
    const existing = scores.get(input.activeSkillId);
    const best = topScore(scores);
    if (!best || best.score < 0.75) {
      scores.set(input.activeSkillId, {
        score: Math.max(existing?.score ?? 0, 0.65),
        category: activeCategory,
        resourceId: existing?.resourceId,
      });
      reasons.push("thread→sticky");
    }
  }

  // Best first, so an unconfident caller can offer the few skills that are
  // genuinely in the running instead of the whole shelf.
  const candidates = [...scores.entries()]
    .map(([skillId, entry]) => ({
      skillId,
      score: Number(entry.score.toFixed(2)),
    }))
    .sort((a, b) => b.score - a.score);

  const winner = topScore(scores);
  if (!winner) {
    return { skillId: null, confidence: 0, candidates, reasons: ["no-match"] };
  }

  const supportId = SUPPORT[winner.category];
  const supportScore = supportId ? scores.get(supportId)?.score : undefined;
  const supportCategory = supportId ? categoryOf(supportId) : null;
  const supporting =
    supportId &&
    supportScore !== undefined &&
    supportId !== winner.id &&
    supportCategory &&
    !disabled.has(supportCategory)
      ? supportId
      : undefined;

  return {
    skillId: winner.id,
    confidence: Number(winner.score.toFixed(2)),
    ...(winner.resourceId ? { resourceId: winner.resourceId } : {}),
    ...(supporting ? { supportingSkillId: supporting } : {}),
    candidates,
    reasons,
  };
}

function topScore(
  scores: Map<
    string,
    { score: number; category: SkillCategory; resourceId?: string }
  >,
): {
  id: string;
  score: number;
  category: SkillCategory;
  resourceId?: string;
} | null {
  let best: {
    id: string;
    score: number;
    category: SkillCategory;
    resourceId?: string;
  } | null = null;
  for (const [id, entry] of scores) {
    if (!best || entry.score > best.score) {
      best = { id, ...entry };
    }
  }
  return best;
}

/** A skill's category without loading its text. */
function categoryOf(skillId: string): SkillCategory | null {
  return getSkill(skillId)?.category ?? null;
}
