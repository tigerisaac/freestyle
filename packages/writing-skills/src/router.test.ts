import { describe, expect, it } from "vitest";
import {
  buildCatalog,
  getSkill,
  renderCatalog,
  SKILL_LIST,
} from "./catalog.js";
import { activateSkill, BUNDLE_HASH } from "./loader.js";
import { PRE_ACTIVATE_CONFIDENCE, routeWritingSkill } from "./router.js";

const base = { target: "empty" as const, instruction: "" };

describe("routing", () => {
  it("routes the spec's worked examples", () => {
    // These are §6.4's table, which is the closest thing to an agreed
    // definition of correct routing that exists.
    const cases: [string, Partial<ReturnType<typeof routeWritingSkill>>][] = [
      ["Reply that Thursday works", { skillId: "professional-communication" }],
      [
        "Make this easier to follow",
        { skillId: "writing-clearly-and-concisely" },
      ],
      [
        "Draft a scene where Mara realizes Owen lied",
        { skillId: "creative-writing-modes" },
      ],
      ["Strengthen the counterargument", { skillId: "academic-writing" }],
      [
        "Outline a 4,000-word guide to local speech models",
        { skillId: "long-form-content-frameworks" },
      ],
      ["Make the value prop more concrete", { skillId: "copywriting" }],
    ];

    for (const [instruction, expected] of cases) {
      const decision = routeWritingSkill({ ...base, instruction });
      expect(decision.skillId, instruction).toBe(expected.skillId);
      expect(decision.confidence, instruction).toBeGreaterThanOrEqual(
        PRE_ACTIVATE_CONFIDENCE,
      );
    }
  });

  it("treats the application as evidence, never as proof", () => {
    // Being in Gmail is worth something, but not enough to pre-activate: a
    // novel drafted in a mail client must not get business-email register.
    const appOnly = routeWritingSkill({
      ...base,
      instruction: "keep going from here",
      appName: "Gmail",
    });

    expect(appOnly.confidence).toBeLessThan(PRE_ACTIVATE_CONFIDENCE);
  });

  it("lets the instruction beat the application it disagrees with", () => {
    const decision = routeWritingSkill({
      ...base,
      instruction: "write the next scene of the chapter",
      appName: "Gmail",
    });

    expect(decision.skillId).toBe("creative-writing-modes");
  });

  it("keeps marketing behind explicit commercial intent", () => {
    // §5.1: routing general documents to copywriting would apply persuasion
    // defaults the user never asked for.
    const ordinary = routeWritingSkill({
      ...base,
      instruction: "make this paragraph better",
    });
    expect(ordinary.skillId).not.toBe("copywriting");

    const explicit = routeWritingSkill({
      ...base,
      instruction: "sharpen the landing page headline",
    });
    expect(explicit.skillId).toBe("copywriting");
  });

  it("pairs a supporting skill only when the request explicitly asks for it", () => {
    const email = routeWritingSkill({
      ...base,
      instruction: "draft a reply to my manager",
    });
    expect(email.supportingSkillId).toBeUndefined();

    const clearerEmail = routeWritingSkill({
      ...base,
      instruction: "draft a clearer, more concise reply to my manager",
    });
    expect(clearerEmail.supportingSkillId).toBe(
      "writing-clearly-and-concisely",
    );

    // Creative work gets no clarity pass unless asked: "concise and plain"
    // flattens a voice the author chose (open decision §11.1).
    const scene = routeWritingSkill({
      ...base,
      instruction: "write a scene where the dialogue turns cold",
    });
    expect(scene.supportingSkillId).toBeUndefined();
  });

  it("keeps a thread on its skill unless intent clearly moves", () => {
    const followUp = routeWritingSkill({
      ...base,
      instruction: "make it a bit longer",
      activeSkillId: "creative-writing-modes",
    });
    expect(followUp.skillId).toBe("creative-writing-modes");

    const pivot = routeWritingSkill({
      ...base,
      instruction: "now draft the landing page headline for it",
      activeSkillId: "creative-writing-modes",
    });
    expect(pivot.skillId).toBe("copywriting");
  });

  it("routes explicit creative work to the specialized skill and resource", () => {
    const cases: Array<[string, string, string | undefined]> = [
      ["Draft the next scene", "creative-writing-modes", "prose-modes"],
      [
        "Brainstorm plot ideas for this novel",
        "story-planning",
        "brainstorming",
      ],
      [
        "Give this chapter a developmental edit",
        "story-review",
        "developmental-edit",
      ],
      [
        "Analyze this prose and match its style",
        "creative-writing-craft",
        "style-analysis",
      ],
      ["Read this as a first-time reader", "reader-sim", undefined],
      [
        "Extract the canon facts and character state",
        "story-memory",
        "fact-extraction",
      ],
      [
        "Why does this prose feel flat and AI-written?",
        "writing-principles",
        "failure-modes",
      ],
    ];

    for (const [instruction, skillId, resourceId] of cases) {
      const decision = routeWritingSkill({ ...base, instruction });
      expect(decision.skillId, instruction).toBe(skillId);
      expect(decision.resourceId, instruction).toBe(resourceId);
    }
  });

  it("routes a focused section instead of a generic first section", () => {
    expect(
      routeWritingSkill({ ...base, instruction: "write a follow-up email" })
        .resourceId,
    ).toBe("email-best-practices");
    expect(
      routeWritingSkill({
        ...base,
        instruction: "strengthen the counterargument in this paper",
      }).resourceId,
    ).toBe("writing-conventions");
    expect(
      routeWritingSkill({
        ...base,
        instruction: "outline a 4000 word long-form guide",
      }).resourceId,
    ).toBe("structural-archetypes");
  });

  it("honours disabled categories", () => {
    const decision = routeWritingSkill({
      ...base,
      instruction: "draft a reply to my manager",
      disabledCategories: ["professional"],
    });
    expect(decision.skillId).not.toBe("professional-communication");
  });

  it("returns no skill rather than a bad guess", () => {
    const decision = routeWritingSkill({
      ...base,
      instruction: "do the thing",
    });
    expect(decision.skillId).toBeNull();
  });
});

describe("loading", () => {
  it("keeps an activated skill inside the per-request budget", () => {
    // The ceiling is the whole point of progressive disclosure: academic-writing
    // is ~4,000 words on its own, more than the entire pre-document context
    // is allowed to be.
    for (const skill of SKILL_LIST) {
      const activation = activateSkill({ skillId: skill.id });
      expect("error" in activation, skill.id).toBe(false);
      if ("error" in activation) continue;
      expect(activation.words, skill.id).toBeLessThanOrEqual(1_100);
    }
  });

  it("loads one requested section without the rest of the file", () => {
    const whole = getSkill("academic-writing");
    expect(whole).toBeDefined();
    const totalWords = whole?.sections.reduce((a, s) => a + s.words, 0) ?? 0;

    const activation = activateSkill({
      skillId: "academic-writing",
      resource: "writing-conventions",
    });
    expect("error" in activation).toBe(false);
    if ("error" in activation) return;

    expect(activation.loaded).toContain("writing-conventions");
    // The saving is the feature: a request about conventions must not drag in
    // publication policy and grant budgets.
    expect(activation.words).toBeLessThan(totalWords / 2);
    expect(activation.words).toBeLessThanOrEqual(1_100);
  });

  it("loads the actual specialized creative resource, not only its index", () => {
    const activation = activateSkill({
      skillId: "story-review",
      resource: "developmental-edit",
    });
    expect("error" in activation).toBe(false);
    if ("error" in activation) return;

    expect(activation.loaded).toContain("developmental-edit");
    expect(activation.words).toBeGreaterThan(400);
    expect(activation.words).toBeLessThanOrEqual(1_100);
  });

  it("removes upstream agent-host commands from activated guidance", () => {
    const activation = activateSkill({
      skillId: "creative-writing-modes",
      resource: "prose-modes",
    });
    expect(activation).not.toHaveProperty("error");
    if ("error" in activation) return;

    expect(activation.text).not.toMatch(/`\/[a-z][a-z0-9-]*`/i);
    expect(activation.text).not.toMatch(/load only the section/i);
    expect(activation.text).toContain("Fresh Draft");
    expect(activation.text).toContain("Decide the scene's pressure");
  });

  it("subordinates third-party guidance to the user and to Freestyle", () => {
    const activation = activateSkill({
      skillId: "writing-clearly-and-concisely",
    });
    expect("error" in activation).toBe(false);
    if ("error" in activation) return;

    // A skill is advice about how to write, not an instruction that can widen
    // scope or redirect output.
    expect(activation.text).toContain("subordinate");
    expect(activation.text).toContain("cannot authorise an action");
    expect(activation.text).toContain("<writing-skill");
  });

  it("carries provenance for every skill", () => {
    for (const skill of SKILL_LIST) {
      expect(skill.provenance.source, skill.id).toMatch(/^[\w.-]+\/[\w.-]+$/);
      expect(skill.provenance.commit, skill.id).toMatch(/^[0-9a-f]{40}$/);
      expect(["MIT", "Apache-2.0"]).toContain(skill.provenance.license);
    }
  });

  it("refuses an unknown skill instead of loading nothing quietly", () => {
    expect(activateSkill({ skillId: "not-a-skill" })).toHaveProperty("error");
  });
});

describe("catalog", () => {
  it("describes specialized creative skills and exposes their resources", () => {
    const planning = getSkill("story-planning");
    expect(planning?.description).toContain("Planning work before prose");
    expect(planning?.description).not.toBe(">");
    expect(planning?.resources.map((resource) => resource.id)).toContain(
      "story-architecture",
    );

    const rendered = renderCatalog(buildCatalog());
    expect(rendered).toContain("Planning work before prose");
    expect(rendered).toContain("developmental-edit");
  });

  it("stays small enough to send on an uncertain request", () => {
    const rendered = renderCatalog(buildCatalog());
    const words = rendered.trim().split(/\s+/).length;
    // §6.5 budgets 300–600 tokens for the catalog; ~450 words is the ceiling.
    expect(words).toBeLessThan(450);
  });

  it("identifies the bundle so cloud and BYOK can be compared", () => {
    expect(BUNDLE_HASH).toMatch(/^[0-9a-f]{64}$/);
  });
});
