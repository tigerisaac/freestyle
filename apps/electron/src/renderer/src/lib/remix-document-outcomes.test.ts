/**
 * What the document contains afterwards.
 *
 * `remix-composites.test.ts` asserts that the composer drives the host in the
 * right order. These assert the thing the user actually cares about, which is
 * a different question and was the one nothing was asking: after this turn,
 * does the document hold what they wanted, exactly once?
 *
 * Every case here is a real failure or a real near-miss — the duplication bug
 * that started this, the truncated read that made the old correction gate
 * unsatisfiable, the canvas editor whose document read eats the highlight.
 */

import { describe, expect, it } from "vitest";
import {
  applyText,
  beginRemixTurn,
  createSession,
  readWritingContext,
  runRemixTool,
  undoLastRemix,
} from "./remix-composites";
import { DocumentSim } from "./remix-document-sim";

/** A file the size of one a user would actually have open. */
const PYTHON = `import json
import sys
from pathlib import Path


class Parser:
    """Turn a source file into tokens."""

    def __init__(self, path):
        self.path = Path(path)

    def parse(self, source):
        return source.split()

    def load(self):
        return self.parse(self.path.read_text())


class Writer:
    """Put tokens back onto disk."""

    def __init__(self, target):
        self.target = Path(target)

    def write(self, tokens):
        self.target.write_text(json.dumps(tokens))
        return self.target


def main(argv=sys.argv[1:]):
    parser = Parser(argv[0])
    writer = Writer(argv[1])
    return writer.write(parser.load())
`;

/** A closing paragraph, for the case where the model must find it itself. */
const ESSAY_TAIL =
  "The scheme worked. What it did not do was reduce car ownership, and that number stayed exactly where it had been.";

describe("the duplication bug, as the document sees it", () => {
  it("does not leave two copies when the model rewrites after inserting", async () => {
    // The shape that shipped: the model composes, inserts, decides it can do
    // better, and composes again. Before the revision path, the second insert
    // landed beside the first and the user got the piece twice.
    const sim = new DocumentSim({ text: "Intro.\n\n", selection: [8, 8] });
    const session = createSession();
    await readWritingContext(sim.host(), session);

    await applyText(sim.host(), session, {
      target: "cursor",
      text: "The quarterly numbers are strong.",
    });
    await applyText(sim.host(), session, {
      target: "cursor",
      text: "The quarterly numbers came in strong.",
    });

    expect(sim.countOf("quarterly numbers")).toBe(1);
    expect(sim.text).toBe("Intro.\n\nThe quarterly numbers came in strong.");
  });

  it("refuses a whole-document cleanup aimed at a one-line selection", async () => {
    // The original report, exactly: Remix said it was cleaning the whole file
    // and pasted the entire cleaned file over whichever small span happened
    // to be highlighted. The paste is legal on its face — replacing a
    // highlight is ordinary — so the only way to catch it is to notice that
    // the replacement carries the document's own far edge inside it.
    const sim = new DocumentSim({
      text: PYTHON,
      selection: [0, PYTHON.indexOf("\n")],
    });
    const session = createSession();
    await readWritingContext(sim.host(), session, "document");

    const result = await applyText(sim.host(), session, {
      target: "selection",
      text: PYTHON.replace("source.split()", "source.split(None)"),
    });

    expect(result).toMatchObject({ ok: false, reason: "wrong-target" });
    expect(String(result.next)).toContain("target 'document'");
    expect(sim.text).toBe(PYTHON);
    expect(sim.pastes).toHaveLength(0);
  });

  it("still allows a rewrite that merely starts where the document starts", async () => {
    // The guard must not fire when the highlight IS the opening passage —
    // rewriting your first paragraph legitimately reproduces the document's
    // head, and refusing that would be the cure becoming the disease.
    const opening = "The opening paragraph runs on for a while. ".repeat(8);
    const sim = new DocumentSim({
      text: `${opening}\n\nA second paragraph, also of some length, follows it here.`,
      selection: [0, opening.length],
    });
    const session = createSession();
    await readWritingContext(sim.host(), session, "document");

    const result = await applyText(sim.host(), session, {
      target: "selection",
      text: `${opening}And one more sentence.`,
    });

    expect(result).toMatchObject({ ok: true });
    expect(sim.text).toContain("And one more sentence.");
    expect(sim.countOf("A second paragraph")).toBe(1);
  });

  it("replaces the whole file cleanly through the target that means it", async () => {
    const sim = new DocumentSim({
      text: PYTHON,
      selection: [0, PYTHON.indexOf("\n")],
    });
    const session = createSession();
    await readWritingContext(sim.host(), session, "document");

    await applyText(sim.host(), session, {
      target: "document",
      text: "class Parser:\n    pass\n",
    });

    expect(sim.text).toBe("class Parser:\n    pass\n");
    expect(sim.countOf("class Parser:")).toBe(1);
  });

  it("converges no matter how many times the model changes its mind", async () => {
    const sim = new DocumentSim({ text: "Dear Ana,\n\n", selection: [11, 11] });
    const session = createSession();
    await readWritingContext(sim.host(), session);

    for (const draft of [
      "Thanks for the update.",
      "Thank you for the update.",
      "Thank you for the update — much appreciated.",
    ]) {
      await applyText(sim.host(), session, { target: "cursor", text: draft });
    }

    // Three writes, one result. This is the property that replaced the
    // one-correction quota, and it holds without the model having to know it.
    expect(sim.text).toBe(
      "Dear Ana,\n\nThank you for the update — much appreciated.",
    );
    expect(sim.pastes).toHaveLength(3);
  });

  it("revises in place even when the editor keeps the paste selected", async () => {
    const sim = new DocumentSim({
      text: "",
      selection: [0, 0],
      afterPaste: "keep-selected",
    });
    const session = createSession();
    await readWritingContext(sim.host(), session);

    await applyText(sim.host(), session, { target: "cursor", text: "first" });
    await applyText(sim.host(), session, { target: "cursor", text: "second" });

    expect(sim.text).toBe("second");
  });
});

describe("the conditions that used to make the gate unsatisfiable", () => {
  it("offers a reachable route when the document is too long to read whole", async () => {
    // This is the loop. The old refusal said "read the complete post-edit
    // document", the read came back truncated, and the model went round
    // again. Now the refusal names a target that can actually succeed.
    const sim = new DocumentSim({
      text: `${"long prose. ".repeat(400)}the closing line.`,
      selection: [0, 0],
      readLimit: 500,
    });
    const session = createSession();
    await readWritingContext(sim.host(), session, "document");

    const refused = await applyText(sim.host(), session, {
      target: "document",
      text: "a whole new document",
    });
    expect(refused).toMatchObject({ ok: false, reason: "document-not-read" });
    expect(String(refused.next)).toContain("anchored-passage");

    // And the route it names works, on the same document, with no further
    // reads — which is what makes it a way out rather than another circuit.
    const applied = await applyText(sim.host(), session, {
      target: "anchored-passage",
      anchor: "the closing line.",
      text: "the closing sentence.",
    });
    expect(applied).toMatchObject({ ok: true });
    expect(sim.text.endsWith("the closing sentence.")).toBe(true);
  });

  it("survives a canvas editor, where reading the document eats the highlight", async () => {
    const sim = new DocumentSim({
      text: "one two three",
      selection: [4, 7],
      preciseSelection: false,
      appName: "Google Chrome",
      windowTitle: "Untitled document",
    });
    const session = createSession();

    await readWritingContext(sim.host(), session, "document");

    // select-all + copy is the only read this app supports, and leaving the
    // document under a live select-all is one keystroke from losing it.
    expect(sim.selStart).toBe(sim.selEnd);
    expect(sim.text).toBe("one two three");
  });
});

describe("what a read leaves the model about to do", () => {
  // The most common quality failure is an untouched document: the model
  // composes the writing into its chat reply and stops. The standing brief
  // says not to, thousands of tokens earlier, and loses to a chat model's
  // default. These assertions are on the one instruction that arrives at the
  // moment the choice is made.
  it("points a highlighted target at the write, not at the chat reply", async () => {
    const sim = new DocumentSim({ text: "one two three", selection: [4, 7] });
    const result = await readWritingContext(sim.host(), createSession());

    expect(result.target).toBe("selected");
    expect(String(result.next)).toContain("apply_text target 'selection'");
    expect(String(result.next)).toContain("chat reply is only a one-line");
  });

  it("offers an empty cursor both of its destinations", async () => {
    const sim = new DocumentSim({ text: "body", selection: [0, 0] });
    const result = await readWritingContext(sim.host(), createSession());

    expect(result.target).toBe("empty");
    // Naming `anchored-passage` here is what keeps "rewrite that paragraph"
    // from being answered with an append at the cursor.
    expect(String(result.next)).toContain("anchored-passage");
    expect(String(result.next)).toContain("'cursor'");
  });

  it("tells an unreadable target to write nothing at all", async () => {
    const sim = new DocumentSim({ text: "body", targetUnavailable: true });
    const result = await readWritingContext(sim.host(), createSession());

    expect(result.target).toBe("unavailable");
    expect(String(result.next)).toContain("nothing may be written");
  });

  it("never sends a failed selection write to the cursor", async () => {
    // This exact advice, in an earlier version, produced the worst outcome
    // the harness has recorded: asked to soften the closing paragraph, the
    // model was told to fall back to 'cursor' and duly inserted the softened
    // version at the top of the document while the blunt original stayed at
    // the bottom. Two versions, in the wrong order, both wrong.
    const sim = new DocumentSim({ text: ESSAY_TAIL, selection: [0, 0] });
    const session = createSession();
    await readWritingContext(sim.host(), session);

    const result = await applyText(sim.host(), session, {
      target: "selection",
      text: "a softened closing line.",
    });

    expect(result).toMatchObject({ ok: false, reason: "target-changed" });
    expect(String(result.next)).toContain("anchored-passage");
    expect(String(result.next)).not.toMatch(/use target 'cursor'(?!\s+only)/);
    expect(sim.pastes).toHaveLength(0);
  });
});

describe("replying to something the cursor cannot see", () => {
  // The reported bug. A Gmail reply box is an empty field; the message being
  // replied to is a sibling of it, not inside it. Every read Remix had
  // targeted the focused element, so the agent asked for the document, got
  // "nothing-copied", and asked again — the loop in the screenshot.
  const EMAIL = `IMPORTANT: RSVP For Camp & General Information
Westwood StudentCouncil
Hey Student Council!
StuCo Camp starts next week from August 10th to the 13th from 9 am to 3 pm every day in Mrs. Harwick's room F1106 at Westwood.
RSVP here for confirmation: RSVP Form for Camp 26-27 <https://forms.gle/rsvp>
Love,
Saanvi`;

  it("cannot find the message through a document read, and says so usefully", async () => {
    const sim = new DocumentSim({
      text: "",
      selection: [0, 0],
      preciseSelection: false,
      appName: "Google Chrome",
      windowTitle: "Inbox - Gmail",
      surroundings: EMAIL,
    });
    const session = createSession();

    const result = await readWritingContext(sim.host(), session, "document");

    // An empty compose box copies nothing. The old result stopped at
    // `documentReason` and left the model to invent a next move; it invented
    // "try again".
    expect(result.documentRead).toBe(false);
    expect(result.documentReason).toBe("nothing-copied");
    expect(String(result.next)).toContain("surroundings");
    expect(String(result.next)).toContain("Do not repeat this read");
  });

  it("finds the message in the window around the cursor", async () => {
    const sim = new DocumentSim({
      text: "",
      selection: [0, 0],
      preciseSelection: false,
      appName: "Google Chrome",
      windowTitle: "Inbox - Gmail",
      surroundings: EMAIL,
    });
    const session = createSession();

    const result = await readWritingContext(
      sim.host(),
      session,
      "surroundings",
    );

    expect(result.ok).toBe(true);
    // The details a reply actually needs: who sent it, when the thing is,
    // and where. A vision model reading a screenshot can miss any of these;
    // the accessibility tree gives them verbatim.
    expect(String(result.surroundings)).toContain("Saanvi");
    expect(String(result.surroundings)).toContain("August 10th to the 13th");
    expect(String(result.surroundings)).toContain("F1106");
    expect(String(result.surroundings)).toContain("https://forms.gle/rsvp");
  });

  it("writes the reply into the compose box, not over the email", async () => {
    const sim = new DocumentSim({
      text: "",
      selection: [0, 0],
      preciseSelection: false,
      appName: "Google Chrome",
      windowTitle: "Inbox - Gmail",
      surroundings: EMAIL,
    });
    const session = createSession();
    await readWritingContext(sim.host(), session, "surroundings");

    const written = await applyText(sim.host(), session, {
      target: "cursor",
      text: "Hi Saanvi — I have RSVP'd and put camp in my calendar. See you on the 10th!",
    });

    // The surroundings are read-only by construction: there is no target that
    // writes to them, so a reply can only ever land in the field the user is
    // actually typing into.
    expect(written).toMatchObject({ ok: true, applied: "cursor" });
    expect(sim.text).toContain("Hi Saanvi");
    expect(sim.text).not.toContain("StuCo Camp starts");
  });

  it("says plainly when the window cannot be read at all", async () => {
    const sim = new DocumentSim({ text: "", selection: [0, 0] });
    const result = await readWritingContext(
      sim.host(),
      createSession(),
      "surroundings",
    );

    expect(result.ok).toBe(true);
    expect(result.surroundingsRead).toBe(false);
    expect(String(result.next)).toContain("ask the user");
  });
});

describe("a long session", () => {
  it("gives each user turn a fresh budget and a fresh revision anchor", async () => {
    const sim = new DocumentSim({ text: "", selection: [0, 0] });
    const session = createSession();

    beginRemixTurn(session);
    await readWritingContext(sim.host(), session);
    await applyText(sim.host(), session, {
      target: "cursor",
      text: "Paragraph one.",
    });

    // A new instruction from the user. The next write is a new contribution,
    // not a revision of the last one — otherwise "now add a second paragraph"
    // would silently delete the first.
    beginRemixTurn(session);
    await readWritingContext(sim.host(), session);
    await applyText(sim.host(), session, {
      target: "cursor",
      text: " Paragraph two.",
    });

    expect(sim.text).toBe("Paragraph one. Paragraph two.");
  });

  it("takes back only its own edit, never the user's own work", async () => {
    const sim = new DocumentSim({ text: "the user's own words. " });
    sim.selStart = sim.text.length;
    sim.selEnd = sim.text.length;
    const session = createSession();
    await readWritingContext(sim.host(), session);
    await applyText(sim.host(), session, {
      target: "cursor",
      text: "and ours.",
    });

    expect(await undoLastRemix(sim.host(), session)).toMatchObject({
      ok: true,
    });
    expect(sim.text).toBe("the user's own words. ");

    // The next undo would start eating the user's typing, so it is refused
    // rather than passed through to the app.
    expect(await undoLastRemix(sim.host(), session)).toMatchObject({
      ok: false,
      retryable: false,
    });
    expect(sim.text).toBe("the user's own words. ");
  });

  it("writes nothing at all once a turn has started looping", async () => {
    const sim = new DocumentSim({ text: "body", selection: [0, 0] });
    const session = createSession();
    await runRemixTool(sim.host(), session, "read_writing_context", {});

    // An anchor the document does not contain, retried forever. What matters
    // is not which refusal comes back but that the document is untouched.
    let last: Record<string, unknown> = {};
    for (let i = 0; i < 8; i++) {
      last = await runRemixTool(sim.host(), session, "apply_text", {
        target: "anchored-passage",
        anchor: "a passage that is not there",
        text: "replacement",
      });
    }

    expect(last).toMatchObject({ retryable: false });
    expect(sim.text).toBe("body");
    expect(sim.pastes).toHaveLength(0);
  });
});
