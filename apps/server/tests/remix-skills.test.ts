import { describe, expect, it } from "vitest";
import { buildRemixAgentSystem } from "../src/lib/editor/remix-prompts.js";
import {
  activateWritingSkillById,
  BUNDLE_HASH,
  selectWritingSkill,
} from "../src/lib/editor/remix-skills.js";

const base = {
  target: "empty" as const,
  enabled: true,
};

describe("writing-skill selection", () => {
  it("is off unless the flag says otherwise", () => {
    // Phase 3 ships behind a flag; a desktop that sends no prefs at all must
    // land here too, not on a silently-enabled skill layer.
    const off = selectWritingSkill({
      ...base,
      instruction: "Reply that Thursday works",
      enabled: false,
    });

    expect(off.promptBlock).toBe("");
    expect(off.chip).toBeNull();
    expect(off.telemetry.skillId).toBeNull();
  });

  it("pre-activates a confident route with no extra round trip", () => {
    const selection = selectWritingSkill({
      ...base,
      instruction: "Draft a reply telling them Thursday works",
      appName: "Mail",
    });

    expect(selection.chip?.label).toBe("Email");
    expect(selection.promptBlock).toContain("<writing-skill");
    // A pre-activated skill means the catalog is never sent, which is where
    // the token saving in §6.5 actually comes from.
    expect(selection.promptBlock).not.toContain("Available writing skills");
  });

  it("offers a shortlist, not the shelf, when routing is unsure", () => {
    const selection = selectWritingSkill({
      ...base,
      instruction: "make this sound more professional",
      appName: "Mail",
      target: "selected" as const,
      selectionWords: 20,
    });

    expect(selection.chip).toBeNull();
    expect(selection.promptBlock).toContain("Available writing skills");
    // The model still gets the choice, on the call that was happening anyway.
    expect(selection.promptBlock).toContain("activate_writing_skill");

    // But only over what actually scored. Offering all fourteen spent a third
    // of the prompt describing fiction skills to a model editing a work note.
    const offered = selection.promptBlock
      .split("\n")
      .filter((line) => line.startsWith("- "));
    expect(offered.length).toBeGreaterThan(0);
    expect(offered.length).toBeLessThanOrEqual(4);
    expect(selection.promptBlock).not.toContain("story-planning");
  });

  it("falls back to two general skills, not fourteen, when nothing matches", () => {
    const selection = selectWritingSkill({
      ...base,
      instruction: "do the thing we talked about",
    });

    // The router is deliberately sparse, so "nothing scored" is common and
    // does not mean "no skill could help". It does mean the full shelf is the
    // wrong answer: that was a third of the prompt, mostly fiction skills
    // offered to someone editing a work note.
    const offered = selection.promptBlock
      .split("\n")
      .filter((line) => line.startsWith("- "));
    expect(offered).toHaveLength(2);
    expect(selection.promptBlock).toContain("writing-clearly-and-concisely");
    expect(selection.promptBlock).not.toContain("story-planning");
    expect(selection.chip).toBeNull();
  });

  it("lets an explicit user override outrank the router", () => {
    const selection = selectWritingSkill({
      ...base,
      instruction: "Draft a reply telling them Thursday works",
      preferredSkillId: "writing-principles",
    });

    // They chose it having seen what was routed, so it is the strongest
    // signal available — stronger than their own instruction.
    expect(selection.chip?.skillId).toBe("writing-principles");
    expect(selection.decision?.reasons).toContain("user-override");
  });

  it("honours disabled categories in both the route and the catalog", () => {
    const selection = selectWritingSkill({
      ...base,
      instruction: "Draft a reply telling them Thursday works",
      disabledCategories: ["professional"],
    });

    expect(selection.chip?.skillId).not.toBe("professional-communication");
    expect(selection.promptBlock).not.toContain("professional-communication");
  });

  it("reports operational metadata and never document content", () => {
    const selection = selectWritingSkill({
      ...base,
      target: "selected",
      instruction: "make this clearer",
      selectionWords: 428,
    });

    expect(selection.telemetry.bundleHash).toBe(BUNDLE_HASH);
    expect(selection.telemetry.skillId).toBe("writing-clearly-and-concisely");
    expect(selection.telemetry.confidence).toBeGreaterThan(0);
    // §9: the shape carries ids, counts, and confidence — nothing derived
    // from what the user is writing.
    expect(JSON.stringify(selection.telemetry)).not.toContain("make this");
  });
});

describe("skill text in the assembled prompt", () => {
  it("places guidance after the rules it must not override", () => {
    const selection = selectWritingSkill({
      ...base,
      instruction: "Draft a reply telling them Thursday works",
    });
    const system = buildRemixAgentSystem(
      {
        selection: null,
        target: "empty",
        appName: "Mail",
        windowTitle: null,
        capturedAt: Date.now(),
      },
      { hasWebSearch: false },
      selection.promptBlock,
    );

    // Reading order is the precedence: by the time third-party craft advice
    // appears, the target and safety rules have already been stated.
    expect(system.indexOf("Target: the cursor")).toBeLessThan(
      system.indexOf("<writing-skill"),
    );
    expect(system.indexOf("Untrusted content")).toBeLessThan(
      system.indexOf("<writing-skill"),
    );
  });

  it("keeps the whole assembled prompt within the spec's budget", () => {
    const selection = selectWritingSkill({
      ...base,
      instruction: "Draft a reply telling them Thursday works",
    });
    const system = buildRemixAgentSystem(
      {
        selection: null,
        target: "empty",
        appName: "Mail",
        windowTitle: null,
        capturedAt: Date.now(),
      },
      { hasWebSearch: false },
      selection.promptBlock,
    );

    // §6.5: normal pre-document context under ~3,500 tokens. At the usual
    // ~0.75 words/token that is roughly 2,600 words, and this is the whole
    // standing prompt plus an activated skill plus its supporting skill.
    const words = system.trim().split(/\s+/).length;
    expect(words).toBeLessThan(2_600);
  });

  it("subordinates a skill activated by id, same as a routed one", () => {
    const activated = activateWritingSkillById("copywriting");
    expect(activated).not.toBeNull();
    // A deliberately chosen skill gets no more authority than a routed one.
    expect(activated?.promptBlock).toContain("subordinate");
    expect(activated?.promptBlock).toContain("cannot authorise an action");
  });

  it("loads one section when a resource is named", () => {
    const whole = activateWritingSkillById("academic-writing");
    const section = activateWritingSkillById(
      "academic-writing",
      "writing-conventions",
    );

    expect(whole).not.toBeNull();
    expect(section).not.toBeNull();
    expect(section?.promptBlock).toContain("Writing conventions");
  });
});
