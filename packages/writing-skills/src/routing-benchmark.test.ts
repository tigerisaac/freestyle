/**
 * The §8.4 routing gates, measured over the labelled corpus.
 *
 * The behavioural tests in `router.test.ts` ask whether a given rule fires.
 * This asks a different question — how often the table is right across a
 * population of realistic requests — and it is the only one of the two that
 * can catch a rule that passes its own test while misfiring on everything
 * nearby.
 *
 * The gate that matters most is precision on high-confidence routes, not raw
 * accuracy. A router that shrugs is merely unhelpful: the request falls
 * through to the catalog and the model picks with the whole instruction in
 * front of it, which costs nothing extra because it rides the call that was
 * already happening. A router that is confidently wrong has spent the budget
 * on the wrong advice and put a chip in the UI asserting it. So a miss with
 * low confidence is cheap and a miss above the threshold is not, and they are
 * counted separately here.
 */

import { describe, expect, it } from "vitest";
import { PRE_ACTIVATE_CONFIDENCE, routeWritingSkill } from "./router.js";
import {
  ROUTING_CORPUS,
  ROUTING_HELDOUT,
  type RoutingCase,
  type RoutingSlice,
} from "./routing-corpus.js";

interface Graded {
  id: string;
  slice: RoutingSlice;
  skillId: string | null;
  confidence: number;
  preActivated: boolean;
  /** A positive case that routed to the wrong skill. */
  wrongSkill: boolean;
  /** A trap that routed to a skill it was baited into. */
  trapped: boolean;
  /** A case that should have stayed unsure and did not. */
  overConfident: boolean;
  /** The focused resource was expected and is missing or wrong. */
  wrongResource: boolean;
  detail: string;
}

function grade(cases: RoutingCase[] = ROUTING_CORPUS): Graded[] {
  return cases.map((c) => {
    const d = routeWritingSkill(c.input);
    const preActivated = d.confidence >= PRE_ACTIVATE_CONFIDENCE;
    const wrongSkill = c.want !== undefined && d.skillId !== c.want;
    const trapped = (c.reject ?? []).some((r) => r === d.skillId);
    const overConfident =
      c.maxConfidence !== undefined && d.confidence > c.maxConfidence;
    const wrongResource =
      c.wantResource !== undefined && d.resourceId !== c.wantResource;

    const notes: string[] = [];
    if (wrongSkill) notes.push(`want ${c.want}, got ${d.skillId}`);
    if (trapped) notes.push(`trapped into ${d.skillId}`);
    if (overConfident) {
      notes.push(`confidence ${d.confidence} > ${c.maxConfidence}`);
    }
    if (wrongResource) {
      notes.push(`want resource ${c.wantResource}, got ${d.resourceId}`);
    }

    return {
      id: c.id,
      slice: c.slice,
      skillId: d.skillId,
      confidence: d.confidence,
      preActivated,
      wrongSkill,
      trapped,
      overConfident,
      wrongResource,
      detail: notes.join("; "),
    };
  });
}

/** Anything that makes a case wrong, resource choice aside. */
function missed(g: Graded): boolean {
  return g.wrongSkill || g.trapped || g.overConfident;
}

describe("routing accuracy over the corpus", () => {
  const graded = grade();

  it("reports the corpus", () => {
    const bySlice = new Map<RoutingSlice, Graded[]>();
    for (const g of graded) {
      const list = bySlice.get(g.slice) ?? [];
      list.push(g);
      bySlice.set(g.slice, list);
    }

    const lines: string[] = [];
    for (const [slice, list] of bySlice) {
      const bad = list.filter(missed);
      lines.push(
        `  ${slice.padEnd(16)} ${list.length - bad.length}/${list.length}`,
      );
      for (const g of bad) lines.push(`      ✗ ${g.id}: ${g.detail}`);
    }
    const failures = graded.filter(missed);
    const confident = graded.filter((g) => g.preActivated);
    const confidentWrong = confident.filter(missed);
    const resourceMisses = graded.filter((g) => g.wrongResource);

    console.log(
      [
        "",
        `routing corpus: ${graded.length - failures.length}/${graded.length} correct`,
        ...lines,
        `  high-confidence precision: ${confident.length - confidentWrong.length}/${confident.length}`,
        `  focused-resource misses:   ${resourceMisses.length}`,
        ...resourceMisses.map((g) => `      · ${g.id}: ${g.detail}`),
        "",
      ].join("\n"),
    );
    expect(graded.length).toBeGreaterThan(0);
  });

  it("meets the §8.4 precision gate on high-confidence routes", () => {
    const confident = graded.filter((g) => g.preActivated);
    const wrong = confident.filter(missed);
    // The gate is about what gets pre-activated. Below the threshold the
    // request goes to the catalog, which is a correct outcome for a request
    // the table genuinely cannot call.
    expect(
      wrong.map((g) => `${g.id}: ${g.detail}`),
      "high-confidence routes must be right",
    ).toEqual([]);
    expect(confident.length / graded.length).toBeGreaterThan(0.5);
  });

  it("does not fall into the keyword traps", () => {
    const trapped = graded.filter((g) => g.trapped);
    expect(trapped.map((g) => `${g.id}: ${g.detail}`)).toEqual([]);
  });

  it("routes each positive slice correctly", () => {
    const wrong = graded.filter((g) => g.wrongSkill);
    expect(wrong.map((g) => `${g.id}: ${g.detail}`)).toEqual([]);
  });

  it("loads the focused resource the route implies", () => {
    const wrong = graded.filter((g) => g.wrongResource);
    expect(wrong.map((g) => `${g.id}: ${g.detail}`)).toEqual([]);
  });

  // The corpus above was tuned against, so on its own it proves only that the
  // table was fitted to it. These were written afterwards and never adjusted;
  // when the rules were tiered they went from 9/12 to 12/12, and each of the
  // three that moved belonged to a different one of the three fixes. That is
  // what says the fixes were about the distinctions and not about the cases.
  //
  // Tune the rules until this passes; do not edit a case to make it pass.
  it("generalises to cases it was not tuned against", () => {
    const wrong = grade(ROUTING_HELDOUT).filter(missed);
    expect(wrong.map((g) => `${g.id}: ${g.detail}`)).toEqual([]);
  });
});
