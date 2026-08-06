/**
 * The reviewed allowlist: every third-party file Freestyle ships, named.
 *
 * The importer will vendor nothing that is not listed here. That is
 * deliberate — "vendor this skill directory" would quietly pick up whatever
 * upstream added since the last review, and the point of pinning a commit is
 * to know exactly what is in the build. Adding content is a manual edit to
 * this file plus a re-run of the importer, with the diff visible in review.
 *
 * `chipLabel` and `category` are Freestyle's, not upstream's. Everything else
 * — name, description, prose — is preserved verbatim, per the adoption policy
 * in §5.3: we ship their craft, not our paraphrase of it.
 */

import type { SkillCategory } from "./src/types.js";

export interface ManifestResource {
  /** Path within the upstream repository. */
  path: string;
  /** Stable id used by `activate_writing_skill({ resource })`. */
  id: string;
  summary: string;
}

export interface ManifestSkill {
  id: string;
  category: SkillCategory;
  chipLabel: string;
  /** Path to the skill's SKILL.md within the upstream repository. */
  entry: string;
  /**
   * Split the entry into addressable sections at `## ` headings.
   *
   * Set for entry files too large to load whole — the academic and long-form
   * skills run to ~4,000 words, several times the per-request budget for an
   * active skill. Small entries load in one piece and set this false.
   */
  sectioned: boolean;
  resources?: ManifestResource[];
}

export interface ManifestSource {
  /** `owner/repo` on GitHub. */
  repo: string;
  /**
   * The reviewed commit. Frozen at implementation time from the research pins
   * in §5.1, each of which was still the upstream HEAD when re-checked.
   */
  commit: string;
  /** Expected SPDX id. The importer fails if the repo's LICENSE disagrees. */
  license: string;
  licensePath: string;
  skills: ManifestSkill[];
}

export const UPSTREAM_SOURCES: ManifestSource[] = [
  {
    repo: "softaworks/agent-toolkit",
    commit: "3027f20f3181758385a1bb8c022d4041dfb4de84",
    license: "MIT",
    licensePath: "LICENSE",
    skills: [
      {
        id: "writing-clearly-and-concisely",
        category: "clarity",
        chipLabel: "Clarity",
        entry: "skills/writing-clearly-and-concisely/SKILL.md",
        sectioned: false,
        resources: [
          {
            path: "skills/writing-clearly-and-concisely/elements-of-style/03-elementary-principles-of-composition.md",
            id: "composition",
            summary:
              "Strunk's principles of composition: paragraph structure, active voice, positive form, concision.",
          },
          {
            path: "skills/writing-clearly-and-concisely/elements-of-style/05-words-and-expressions-commonly-misused.md",
            id: "misused-words",
            summary:
              "Commonly misused words and expressions, with the correct usage for each.",
          },
          {
            path: "skills/writing-clearly-and-concisely/signs-of-ai-writing.md",
            id: "ai-tells",
            summary:
              "Patterns that mark text as machine-written, and what to do instead.",
          },
        ],
      },
      {
        id: "professional-communication",
        category: "professional",
        chipLabel: "Email",
        entry: "skills/professional-communication/SKILL.md",
        sectioned: true,
        resources: [
          {
            path: "skills/professional-communication/references/email-templates.md",
            id: "email-patterns",
            summary:
              "Structures for common workplace emails: requests, updates, escalations, declines.",
          },
          {
            path: "skills/professional-communication/references/jargon-simplification.md",
            id: "plain-language",
            summary:
              "Replacing corporate jargon with plain language that says the same thing.",
          },
        ],
      },
    ],
  },
  {
    repo: "haowjy/creative-writing-skills",
    commit: "52e6adce0951b14894732d7759392347b35a856f",
    license: "Apache-2.0",
    licensePath: "LICENSE",
    skills: [
      {
        id: "writing-principles",
        category: "creative",
        chipLabel: "Creative",
        entry: "skills/writing-principles/SKILL.md",
        sectioned: false,
        resources: [
          {
            path: "skills/writing-principles/resources/failure-modes.md",
            id: "failure-modes",
            summary:
              "Fiction failure modes caused by LLM habits, with examples and repair heuristics.",
          },
        ],
      },
      {
        id: "creative-writing-craft",
        category: "creative",
        chipLabel: "Creative · Craft",
        entry: "skills/creative-writing-craft/SKILL.md",
        sectioned: false,
        resources: [
          {
            path: "skills/creative-writing-craft/resources/prose-writing.md",
            id: "prose-writing",
            summary:
              "POV, psychic distance, rhythm, sensory grounding, interiority, and subtext.",
          },
          {
            path: "skills/creative-writing-craft/resources/scene-construction.md",
            id: "scene-construction",
            summary:
              "Scene entry and exit, dialogue, pacing, transitions, and connective tissue.",
          },
          {
            path: "skills/creative-writing-craft/resources/style-analysis.md",
            id: "style-analysis",
            summary:
              "Analyze prose samples and build an operational style reference.",
          },
          ...[
            "fantasy",
            "horror",
            "litfic",
            "mystery",
            "romance",
            "thriller",
          ].map((genre) => ({
            path: `skills/creative-writing-craft/resources/genre/${genre}.md`,
            id: `genre-${genre}`,
            summary: `${genre} genre promises and page-level craft guidance.`,
          })),
        ],
      },
      {
        id: "creative-writing-modes",
        category: "creative",
        chipLabel: "Creative · Mode",
        entry: "skills/creative-writing-modes/SKILL.md",
        sectioned: false,
        resources: [
          {
            path: "skills/creative-writing-modes/resources/prose-modes.md",
            id: "prose-modes",
            summary:
              "Methods for fresh drafting, revision, bridges, alternate takes, and line polish.",
          },
        ],
      },
      {
        id: "story-planning",
        category: "creative",
        chipLabel: "Creative · Planning",
        entry: "skills/story-planning/SKILL.md",
        sectioned: false,
        resources: [
          {
            path: "skills/story-planning/resources/creative-direction.md",
            id: "creative-direction",
            summary:
              "Turn author intent into concrete direction without taking authorship away.",
          },
          {
            path: "skills/story-planning/resources/brainstorming.md",
            id: "brainstorming",
            summary:
              "Generate, compare, and synthesize story possibilities before committing.",
          },
          {
            path: "skills/story-planning/resources/story-architecture.md",
            id: "story-architecture",
            summary:
              "Move from direction to arcs, chapters, scenes, beats, and structural diagnosis.",
          },
          {
            path: "skills/story-planning/resources/brainstorming/chapter-planning.md",
            id: "chapter-planning",
            summary: "Plan a chapter's purpose, pressure, turn, and handoff.",
          },
          {
            path: "skills/story-planning/resources/brainstorming/character-development.md",
            id: "character-development",
            summary:
              "Develop characters through desire, contradiction, pressure, and change.",
          },
          {
            path: "skills/story-planning/resources/brainstorming/continuity-timeline.md",
            id: "continuity-timeline",
            summary:
              "Reason about chronology, travel, causality, and continuity constraints.",
          },
          {
            path: "skills/story-planning/resources/brainstorming/worldbuilding.md",
            id: "worldbuilding",
            summary:
              "Build story-relevant worlds through constraints, consequences, and lived detail.",
          },
          {
            path: "skills/story-planning/resources/story-architecture/arc-design.md",
            id: "arc-design",
            summary:
              "Design escalating story and character arcs with earned turns.",
          },
          {
            path: "skills/story-planning/resources/story-architecture/chapter-and-scene.md",
            id: "chapter-and-scene",
            summary:
              "Translate an arc into purposeful chapter, scene, and beat structure.",
          },
          {
            path: "skills/story-planning/resources/story-architecture/structural-problems.md",
            id: "structural-problems",
            summary:
              "Diagnose common structural failures before prose-level revision.",
          },
        ],
      },
      {
        id: "story-review",
        category: "creative",
        chipLabel: "Creative · Review",
        entry: "skills/story-review/SKILL.md",
        sectioned: false,
        resources: [
          {
            path: "skills/story-review/resources/editorial-review.md",
            id: "editorial-review",
            summary:
              "Holistic book-editor review that identifies the right revision order.",
          },
          {
            path: "skills/story-review/resources/developmental-edit.md",
            id: "developmental-edit",
            summary:
              "Evaluate structure, causality, pacing, promise, and character arcs.",
          },
          {
            path: "skills/story-review/resources/line-edit.md",
            id: "line-edit",
            summary: "Review voice, rhythm, clarity, precision, and texture.",
          },
          {
            path: "skills/story-review/resources/copyedit.md",
            id: "copyedit",
            summary:
              "Correct grammar, usage, punctuation, and consistency without flattening voice.",
          },
          {
            path: "skills/story-review/resources/proofreading.md",
            id: "proofreading",
            summary:
              "Run a final surface pass after substantive editing is stable.",
          },
          {
            path: "skills/story-review/resources/reader-sim-signal.md",
            id: "reader-sim-signal",
            summary:
              "Synthesize first-reader reactions without mistaking them for universal truth.",
          },
          ...[
            "antipatterns",
            "character",
            "continuity",
            "prose",
            "structure",
            "voice",
          ].map((focus) => ({
            path: `skills/story-review/resources/prose-critique/${focus}.md`,
            id: `critique-${focus}`,
            summary: `Deep prose-critique guidance focused on ${focus}.`,
          })),
        ],
      },
      {
        id: "story-memory",
        category: "creative",
        chipLabel: "Creative · Continuity",
        entry: "skills/story-memory/SKILL.md",
        sectioned: false,
        resources: [
          {
            path: "skills/story-memory/resources/story-context.md",
            id: "story-context",
            summary:
              "Choose the minimum canon, style, and scene context needed for a handoff.",
          },
          {
            path: "skills/story-memory/resources/fact-extraction.md",
            id: "fact-extraction",
            summary:
              "Extract durable character, timeline, reveal, and terminology facts from prose.",
          },
          {
            path: "skills/story-memory/resources/story-reference-writing.md",
            id: "story-reference-writing",
            summary:
              "Write concise canon references, decisions, summaries, and issue logs.",
          },
          {
            path: "skills/story-memory/resources/writing-artifacts.md",
            id: "writing-artifacts",
            summary: "Organize story work and knowledge artifacts by purpose.",
          },
          {
            path: "skills/story-memory/resources/writing-issues.md",
            id: "writing-issues",
            summary:
              "Track persistent writing issues across chapters without duplicating critique.",
          },
        ],
      },
      {
        id: "reader-sim",
        category: "creative",
        chipLabel: "Creative · Reader",
        entry: "skills/reader-sim/SKILL.md",
        sectioned: false,
      },
    ],
  },
  {
    repo: "coreyhaines31/marketingskills",
    commit: "7868cb9251fad80a73d26e488a5ad5f6c4a9f335",
    license: "MIT",
    licensePath: "LICENSE",
    skills: [
      {
        id: "copywriting",
        category: "marketing",
        chipLabel: "Marketing",
        entry: "skills/copywriting/SKILL.md",
        sectioned: true,
      },
      {
        id: "copy-editing",
        category: "marketing",
        chipLabel: "Marketing · Edit",
        entry: "skills/copy-editing/SKILL.md",
        sectioned: true,
      },
    ],
  },
  {
    repo: "jamditis/claude-skills-journalism",
    commit: "c10dc76a9be09827c6091cab4448617262f4b575",
    license: "MIT",
    licensePath: "LICENSE",
    skills: [
      {
        id: "academic-writing",
        category: "academic",
        chipLabel: "Academic",
        entry: "research-toolkit/skills/academic-writing/SKILL.md",
        // 4,000 words, and it carries time-sensitive publication policy that
        // must never be loaded as though it were current advice. Sectioning
        // is what keeps an argument request from pulling in journal rules.
        sectioned: true,
      },
    ],
  },
  {
    repo: "rampstackco/claude-skills",
    commit: "e42ec5af1bd2b504325098bf6bb1400c11a6c512",
    license: "MIT",
    licensePath: "LICENSE",
    skills: [
      {
        id: "long-form-content-frameworks",
        category: "long-form",
        chipLabel: "Long-form",
        entry: "skills/long-form-content-frameworks/SKILL.md",
        sectioned: true,
      },
    ],
  },
];
