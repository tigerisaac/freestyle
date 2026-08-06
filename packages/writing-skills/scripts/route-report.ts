/**
 * Print the routing corpus report.
 *
 * The gates live in `routing-benchmark.test.ts`, where CI can fail on them.
 * This is the same grading printed as a table, for the times you are changing
 * the rules and want to see what moved rather than only whether it broke.
 *
 * Run:
 *   pnpm exec tsx scripts/route-report.ts [--verbose]
 */

import { PRE_ACTIVATE_CONFIDENCE, routeWritingSkill } from "../src/router.js";
import {
  ROUTING_CORPUS,
  ROUTING_HELDOUT,
  type RoutingCase,
  type RoutingSlice,
} from "../src/routing-corpus.js";

const verbose = process.argv.includes("--verbose");

interface Row {
  id: string;
  slice: RoutingSlice;
  skillId: string | null;
  confidence: number;
  preActivated: boolean;
  problems: string[];
  resourceProblem: string | null;
}

const gradeAll = (cases: RoutingCase[]): Row[] =>
  cases.map((c) => {
    const d = routeWritingSkill(c.input);
    const problems: string[] = [];
    if (c.want !== undefined && d.skillId !== c.want) {
      problems.push(`want ${c.want}, got ${d.skillId}`);
    }
    if ((c.reject ?? []).some((r) => r === d.skillId)) {
      problems.push(`trapped into ${d.skillId}`);
    }
    if (c.maxConfidence !== undefined && d.confidence > c.maxConfidence) {
      problems.push(`confidence ${d.confidence} > ${c.maxConfidence}`);
    }
    return {
      id: c.id,
      slice: c.slice,
      skillId: d.skillId,
      confidence: d.confidence,
      preActivated: d.confidence >= PRE_ACTIVATE_CONFIDENCE,
      problems,
      resourceProblem:
        c.wantResource !== undefined && d.resourceId !== c.wantResource
          ? `want ${c.wantResource}, got ${d.resourceId ?? "none"}`
          : null,
    };
  });

const rows = gradeAll(ROUTING_CORPUS);

const bySlice = new Map<RoutingSlice, Row[]>();
for (const r of rows) {
  bySlice.set(r.slice, [...(bySlice.get(r.slice) ?? []), r]);
}

console.log(`\nRouting corpus — ${rows.length} cases\n`);
for (const [slice, list] of bySlice) {
  const bad = list.filter((r) => r.problems.length > 0);
  const mark = bad.length === 0 ? "ok " : "FAIL";
  console.log(
    `${mark} ${slice.padEnd(16)} ${String(list.length - bad.length).padStart(2)}/${list.length}`,
  );
  for (const r of bad)
    console.log(`        ✗ ${r.id}: ${r.problems.join("; ")}`);
  if (verbose) {
    for (const r of list.filter((x) => x.problems.length === 0)) {
      console.log(
        `        · ${r.id.padEnd(34)} ${String(r.skillId).padEnd(30)} ${r.confidence}`,
      );
    }
  }
}

const failed = rows.filter((r) => r.problems.length > 0);
const confident = rows.filter((r) => r.preActivated);
const confidentWrong = confident.filter((r) => r.problems.length > 0);
const resourceMisses = rows.filter((r) => r.resourceProblem);

const pct = (n: number, d: number) =>
  d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`;

console.log(
  [
    "",
    `overall accuracy            ${rows.length - failed.length}/${rows.length}  ${pct(rows.length - failed.length, rows.length)}`,
    `high-confidence precision   ${confident.length - confidentWrong.length}/${confident.length}  ${pct(confident.length - confidentWrong.length, confident.length)}  (§8.4 gate: 95%)`,
    `pre-activation rate         ${confident.length}/${rows.length}  ${pct(confident.length, rows.length)}`,
    `focused-resource misses     ${resourceMisses.length}`,
    ...resourceMisses.map((r) => `        · ${r.id}: ${r.resourceProblem}`),
    "",
  ].join("\n"),
);

// The held-out set, graded on its own. This is the number to believe: the
// corpus above was tuned against, and this one was not.
const held = gradeAll(ROUTING_HELDOUT);
const heldBad = held.filter((r) => r.problems.length > 0);
console.log(
  [
    `held-out (never tuned to)   ${held.length - heldBad.length}/${held.length}  ${pct(held.length - heldBad.length, held.length)}`,
    ...heldBad.map((r) => `        ✗ ${r.id}: ${r.problems.join("; ")}`),
    "",
  ].join("\n"),
);

process.exit(failed.length > 0 || heldBad.length > 0 ? 1 : 0);
