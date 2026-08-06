/**
 * Joining the skill package to one Remix request.
 *
 * The package decides *which* skill and *what text*; this decides whether a
 * skill is used at all, and how the model is told about it. Kept beside the
 * prompt builder rather than inside the package because it is Freestyle
 * policy — the feature flag, the fallback to the catalog, the token ceiling —
 * and the package is meant to stay pure data that the cloud can import
 * unchanged.
 *
 * Mirrored into the cloud repo: both hosts must assemble the identical
 * prompt from the identical bundle, which is what `BUNDLE_HASH` lets CI check.
 */

import {
  type Activation,
  activateSkill,
  BUNDLE_HASH,
  buildCatalog,
  PRE_ACTIVATE_CONFIDENCE,
  type RouteDecision,
  renderCatalog,
  routeWritingSkill,
  type SkillCategory,
} from "@freestyle-voice/writing-skills";

export { BUNDLE_HASH };

/**
 * How many skills an unconfident route may offer.
 *
 * The catalog is a menu, not a reference: the model reads it once, on this
 * request, to decide whether anything fits. Four ranked candidates is enough
 * for that and short enough to skim. The full list ran to 3,700 characters —
 * a third of the entire prompt for a two-line email edit, most of it
 * describing fiction skills to a model rewriting a note to a colleague.
 */
const CATALOG_SHORTLIST = 4;

/**
 * What to offer when the router matched nothing at all.
 *
 * Clarity applies to any prose worth writing, and most of what Remix is
 * summoned into is correspondence. Between them they cover the ordinary edit
 * without presuming anything about it.
 */
const GENERAL_PURPOSE_SKILLS = [
  "writing-clearly-and-concisely",
  "professional-communication",
];

export interface SkillSelectionInput {
  /** The user's latest instruction — the strongest routing signal. */
  instruction: string;
  target: "selected" | "empty" | "unavailable";
  selectionWords?: number;
  appName?: string | null;
  url?: string | null;
  /** The skill this thread settled on, if any. */
  activeSkillId?: string | null;
  /** Categories switched off in settings. */
  disabledCategories?: readonly SkillCategory[];
  /** A skill the user pinned from the chip's override menu. */
  preferredSkillId?: string;
  /** The whole layer is off unless this is true. */
  enabled: boolean;
}

export interface SkillSelection {
  /** Prompt text to append: an activated skill, a catalog, or nothing. */
  promptBlock: string;
  /** What the pill's chip shows, or null when no skill is active. */
  chip: { skillId: string; label: string } | null;
  decision: RouteDecision | null;
  /** Telemetry only — never document content. */
  telemetry: {
    bundleHash: string;
    skillId: string | null;
    confidence: number;
    loaded: string[];
    words: number;
  };
}

const EMPTY: SkillSelection = {
  promptBlock: "",
  chip: null,
  decision: null,
  telemetry: {
    bundleHash: BUNDLE_HASH,
    skillId: null,
    confidence: 0,
    loaded: [],
    words: 0,
  },
};

/** Useful defaults for follow-up turns that only say "make it shorter" etc. */
const DEFAULT_SKILL_RESOURCES: Readonly<Record<string, string>> = {
  "professional-communication": "core-frameworks",
  "creative-writing-modes": "prose-modes",
  "creative-writing-craft": "prose-writing",
  "story-planning": "story-architecture",
  "story-review": "editorial-review",
  "story-memory": "story-context",
  "writing-principles": "failure-modes",
  copywriting: "copywriting-principles",
  "copy-editing": "the-seven-sweeps-framework",
  "academic-writing": "writing-conventions",
  "long-form-content-frameworks": "structural-archetypes",
};

/**
 * Choose a skill for this request.
 *
 * Three outcomes, and the middle one is the reason the design costs no extra
 * round trip. A confident route pre-activates and the model never knows a
 * decision was made. An unconfident one sends the catalog and lets the model
 * choose with `activate_writing_skill` — on the call that was happening
 * anyway. No match at all sends nothing, which is the honest answer for
 * "reformat this as a table" and should stay cheap.
 */
export function selectWritingSkill(input: SkillSelectionInput): SkillSelection {
  if (!input.enabled || !input.instruction.trim()) return EMPTY;

  // An explicit override outranks the router entirely. The user picking a
  // skill from the chip is the strongest signal there is — stronger than
  // their own instruction, since they chose it having seen what was routed.
  if (input.preferredSkillId) {
    const pinned = activateWritingSkillById(input.preferredSkillId);
    if (pinned) {
      return {
        promptBlock: pinned.promptBlock,
        chip: pinned.chip,
        decision: {
          skillId: input.preferredSkillId,
          confidence: 1,
          candidates: [{ skillId: input.preferredSkillId, score: 1 }],
          reasons: ["user-override"],
        },
        telemetry: {
          bundleHash: BUNDLE_HASH,
          skillId: input.preferredSkillId,
          confidence: 1,
          loaded: pinned.loaded,
          words: pinned.words,
        },
      };
    }
  }

  const decision = routeWritingSkill({
    instruction: input.instruction,
    target: input.target,
    selectionWords: input.selectionWords,
    appName: input.appName,
    url: input.url,
    activeSkillId: input.activeSkillId,
    disabledCategories: input.disabledCategories,
  });

  if (decision.skillId && decision.confidence >= PRE_ACTIVATE_CONFIDENCE) {
    const activation = activateSkill({
      skillId: decision.skillId,
      resource:
        decision.resourceId ?? DEFAULT_SKILL_RESOURCES[decision.skillId],
    });
    if (!("error" in activation)) {
      return {
        promptBlock: renderActivation(activation, decision),
        chip: { skillId: activation.skillId, label: activation.chipLabel },
        decision,
        telemetry: {
          bundleHash: BUNDLE_HASH,
          skillId: activation.skillId,
          confidence: decision.confidence,
          loaded: activation.loaded,
          words: activation.words,
        },
      };
    }
  }

  // What the model may choose from when the router was not sure.
  //
  // It used to be everything, which was both the largest and the least useful
  // block we sent: a third of the prompt for a two-line email edit, most of it
  // describing fiction skills to a model rewriting a note to a colleague.
  //
  // Ranking fixes the case where something scored. The case where nothing
  // scored needs care rather than symmetry — the router is deliberately
  // sparse, and ordinary instructions ("polish this paragraph", "make it
  // punchier") match no rule at all. Offering nothing there would quietly
  // retire the skill layer for exactly the edits people make most. So the
  // fallback is the two skills that apply to almost any prose, which costs
  // two lines instead of fourteen and keeps the escape hatch open.
  const shortlist = new Set(
    decision.candidates.length > 0
      ? decision.candidates.slice(0, CATALOG_SHORTLIST).map((c) => c.skillId)
      : GENERAL_PURPOSE_SKILLS,
  );
  const catalog = renderCatalog(
    buildCatalog(
      (skill) =>
        shortlist.has(skill.id) &&
        !(input.disabledCategories ?? []).includes(skill.category),
    ),
  );
  if (!catalog) return EMPTY;

  return {
    promptBlock: `${catalog}\n\nNone of these was confidently matched to this request. If one clearly fits, call activate_writing_skill before writing; if none does, write without one — that is the normal case for short edits and formatting.`,
    chip: null,
    decision,
    telemetry: {
      bundleHash: BUNDLE_HASH,
      skillId: null,
      confidence: decision.confidence,
      loaded: [],
      words: 0,
    },
  };
}

/**
 * Activate a skill the model asked for by name.
 *
 * The override path, used both by `activate_writing_skill` and by the user
 * picking a different skill from the chip. Same wrapper, same budget — a
 * skill chosen deliberately gets no more authority than one that was routed.
 */
export function activateWritingSkillById(
  skillId: string,
  resource?: string,
): {
  promptBlock: string;
  chip: { skillId: string; label: string };
  loaded: string[];
  words: number;
} | null {
  const activation = activateSkill({
    skillId,
    resource: resource ?? DEFAULT_SKILL_RESOURCES[skillId],
  });
  if ("error" in activation) return null;
  return {
    promptBlock: renderActivation(activation, null),
    chip: { skillId: activation.skillId, label: activation.chipLabel },
    loaded: activation.loaded,
    words: activation.words,
  };
}

function renderActivation(
  activation: Activation,
  decision: RouteDecision | null,
): string {
  const supporting = decision?.supportingSkillId
    ? activateSkill({ skillId: decision.supportingSkillId })
    : null;

  const blocks = [activation.text];
  if (supporting && !("error" in supporting)) {
    blocks.push(supporting.text);
  }
  return blocks.join("\n\n");
}
