import { describe, expect, it } from "vitest";
import {
  applyText,
  beginRemixTurn,
  createSession,
  insertImage,
  REMIX_REPEAT_FAILURE_LIMIT,
  REMIX_TURN_WRITE_LIMIT,
  type RemixHost,
  readWritingContext,
  runRemixTool,
  undoLastRemix,
} from "./remix-composites";

/**
 * A fake machine that records the order it was driven in.
 *
 * The order is the thing under test. Every one of these recipes was prose in
 * the system prompt until now, and prose cannot be asserted on — which is why
 * the failures they describe ("never end your turn with the document fully
 * selected") kept being reachable.
 */
function fakeHost(overrides: Partial<RemixHost> = {}): {
  host: RemixHost;
  calls: string[];
} {
  const calls: string[] = [];
  const record =
    <T>(name: string, result: T) =>
    async (...args: unknown[]): Promise<T> => {
      calls.push(args.length ? `${name}(${JSON.stringify(args[0])})` : name);
      return result;
    };

  const host: RemixHost = {
    remixGetContext: record("getContext", {
      ok: true,
      appName: "Pages",
      windowTitle: "Draft",
      url: null,
      selection: "the old sentence",
      target: { status: "selected" as const, text: "the old sentence" },
      preciseSelection: true,
    }),
    remixReadDocument: record("readDocument", {
      ok: true,
      text: "one two three",
      truncated: false,
      selStart: 4,
      selLen: 3,
    }),
    remixReadSurroundings: record("readSurroundings", {
      ok: true,
      text: "the window around the field",
      truncated: false,
    }),
    remixSelectAll: record("selectAll", { ok: true }),
    remixSelectText: record("selectText", { ok: true }),
    remixCollapseSelection: record("collapse", { ok: true }),
    remixCopy: record("copy", {
      ok: true,
      text: "whole doc",
      truncated: false,
    }),
    remixGetClipboard: record("getClipboard", {
      ok: true,
      text: "clipboard contents",
      truncated: false,
    }),
    remixSetClipboard: record("setClipboard", { ok: true }),
    remixSetClipboardImage: record("setClipboardImage", { ok: true }),
    remixPasteClipboard: record("paste", { ok: true }),
    remixPasteText: record("pasteText", { ok: true }),
    remixPasteImage: record("pasteImage", { ok: true }),
    remixUndo: record("undo", { ok: true }),
    ...overrides,
  };
  return { host, calls };
}

describe("read_writing_context", () => {
  it("costs nothing beyond the context read at the default scope", async () => {
    const { host, calls } = fakeHost();
    const result = await readWritingContext(host, createSession());

    expect(result.ok).toBe(true);
    expect(result.target).toBe("selected");
    // The fast path is one call. A selection scope that reached for the
    // document would put a keystroke in the user's app for nothing.
    expect(calls).toEqual(["getContext"]);
  });

  it("prefers the accessibility read, which leaves the highlight alone", async () => {
    const { host, calls } = fakeHost();
    const result = await readWritingContext(host, createSession(), "document");

    expect(result.text).toBe("one two three");
    expect(calls).toContain("readDocument");
    expect(calls).not.toContain("selectAll");
  });

  it("always collapses after a canvas-editor read, even when the copy fails", async () => {
    const { host, calls } = fakeHost({
      remixGetContext: async () => ({
        ok: true,
        appName: "Google Chrome",
        windowTitle: "Doc",
        url: "https://docs.google.com/x",
        selection: null,
        target: { status: "empty" as const },
        preciseSelection: false,
      }),
      remixCopy: async () => ({ ok: false, reason: "nothing-copied" }),
    });

    await readWritingContext(host, createSession(), "document");

    // The copy failing is recoverable; a document left under a live
    // select-all is one keystroke from being replaced by the next paste.
    expect(calls.indexOf("selectAll")).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf("collapse")).toBeGreaterThan(
      calls.indexOf("selectAll"),
    );
  });

  it("downgrades rather than failing when the deep read is unsupported", async () => {
    const { host } = fakeHost({
      remixReadDocument: async () => ({ ok: false, reason: "unsupported" }),
      remixSelectAll: async () => ({ ok: false, reason: "inject-failed" }),
    });

    const result = await readWritingContext(host, createSession(), "document");

    // Where the user is and what is highlighted is still enough to edit a
    // highlight, so the call answers instead of erroring.
    expect(result.ok).toBe(true);
    expect(result.documentRead).toBe(false);
  });

  it("reads a full clipboard through the same composite surface", async () => {
    const { host, calls } = fakeHost();

    const result = await readWritingContext(host, createSession(), "clipboard");

    expect(result.clipboard).toBe("clipboard contents");
    expect(calls).toEqual(["getContext", "getClipboard"]);
  });
});

describe("apply_text", () => {
  it("delegates text delivery to the clipboard-preserving host transaction", async () => {
    const { host, calls } = fakeHost();
    const session = createSession();
    await readWritingContext(host, session);

    const result = await applyText(host, session, {
      target: "selection",
      text: "the new sentence",
    });

    expect(result).toEqual({ ok: true, applied: "selection" });
    expect(calls).toContain('pasteText("the new sentence")');
    expect(calls).not.toContain('setClipboard("the new sentence")');
  });

  it("collapses before inserting at the cursor", async () => {
    const { host, calls } = fakeHost();
    const session = createSession();

    await applyText(host, session, { target: "cursor", text: "new para" });

    // Paste replaces the selection. Inserting into a live highlight would
    // silently destroy it — the single most-repeated warning in the old prompt.
    expect(calls.indexOf("collapse")).toBeGreaterThan(-1);
    expect(calls.indexOf("collapse")).toBeLessThan(
      calls.indexOf('pasteText("new para")'),
    );
  });

  it("replaces a whole document only after verifying an explicit full read", async () => {
    const { host, calls } = fakeHost();
    const session = createSession();
    await readWritingContext(host, session, "document");

    const result = await applyText(host, session, {
      target: "document",
      text: "clean replacement",
    });

    expect(result).toEqual({ ok: true, applied: "document" });
    expect(calls.filter((call) => call === "readDocument")).toHaveLength(2);
    expect(calls.lastIndexOf("selectAll")).toBeLessThan(
      calls.indexOf('pasteText("clean replacement")'),
    );
  });

  it("refuses a whole-document replacement without a complete document read", async () => {
    const { host, calls } = fakeHost();

    const result = await applyText(host, createSession(), {
      target: "document",
      text: "replacement",
    });

    expect(result.reason).toBe("document-not-read");
    expect(calls.some((call) => call.startsWith("pasteText"))).toBe(false);
  });

  it("refuses a whole-document replacement when the document changed", async () => {
    let document = "original";
    const { host, calls } = fakeHost({
      remixReadDocument: async () => ({
        ok: true,
        text: document,
        truncated: false,
        selStart: 0,
        selLen: 0,
      }),
    });
    const session = createSession();
    await readWritingContext(host, session, "document");
    document = "user changed it";

    const result = await applyText(host, session, {
      target: "document",
      text: "replacement",
    });

    expect(result.reason).toBe("target-changed");
    expect(calls.some((call) => call.startsWith("pasteText"))).toBe(false);
  });

  it("revises its own previous write instead of adding a second copy", async () => {
    const { host, calls } = fakeHost();
    const session = createSession();
    await readWritingContext(host, session);

    expect(
      await applyText(host, session, { target: "cursor", text: "first draft" }),
    ).toMatchObject({ ok: true, applied: "cursor" });

    // The second insert must not append: the host finds what it pasted a
    // moment ago and selects it, so the paste that follows replaces it. This
    // is the whole duplication fix, and it is why an unbounded number of
    // writes still leaves exactly one result in the document.
    expect(
      await applyText(host, session, { target: "cursor", text: "better" }),
    ).toMatchObject({ ok: true, applied: "revised" });
    expect(calls).toContain('selectText("first draft")');
    expect(calls.filter((call) => call.startsWith("pasteText"))).toEqual([
      'pasteText("first draft")',
      'pasteText("better")',
    ]);
  });

  it("treats re-sending the same text as done rather than as a duplicate", async () => {
    const { host, calls } = fakeHost();
    const session = createSession();
    await readWritingContext(host, session);

    await applyText(host, session, { target: "selection", text: "the edit" });
    const again = await applyText(host, session, {
      target: "selection",
      text: "the edit",
    });

    // Answering `ok` is what ends the turn. A refusal here would be one more
    // thing for the model to retry, which is the loop this replaced.
    expect(again).toMatchObject({ ok: true, noop: true });
    expect(calls.filter((call) => call.startsWith("pasteText"))).toHaveLength(
      1,
    );
  });

  it("stops writing once a turn has spent its budget", async () => {
    const { host, calls } = fakeHost();
    const session = createSession();
    await readWritingContext(host, session);

    for (let i = 0; i < REMIX_TURN_WRITE_LIMIT; i++) {
      // Each revision replaces the last, so the fake document only ever holds
      // one of these — the budget is a circuit breaker, not a safety rail.
      host.remixSelectText = async () => ({ ok: true });
      expect(
        await applyText(host, session, {
          target: "cursor",
          text: `draft ${i}`,
        }),
      ).toMatchObject({ ok: true });
    }

    const refused = await applyText(host, session, {
      target: "cursor",
      text: "one more",
    });
    expect(refused).toMatchObject({
      ok: false,
      reason: "write-budget-exhausted",
      retryable: false,
    });
    expect(calls.filter((call) => call.startsWith("pasteText"))).toHaveLength(
      REMIX_TURN_WRITE_LIMIT,
    );

    // A new user turn is a fresh start, not a continuation of the circuit.
    beginRemixTurn(session);
    expect(
      await applyText(host, session, {
        target: "selection",
        text: "next turn",
      }),
    ).toMatchObject({ ok: true });
  });

  it("refuses to revise when its own text is no longer there to replace", async () => {
    const { host, calls } = fakeHost();
    const session = createSession();
    await readWritingContext(host, session);

    await applyText(host, session, { target: "cursor", text: "first draft" });
    // The user typed over it, or the app cannot select text. Appending the
    // revision beside the original is exactly the duplication we prevent.
    host.remixSelectText = async () => ({ ok: false, reason: "not-found" });

    const result = await applyText(host, session, {
      target: "cursor",
      text: "revision",
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "previous-write-not-found",
      retryable: false,
    });
    expect(calls.filter((call) => call.startsWith("pasteText"))).toHaveLength(
      1,
    );
  });

  it("refuses to replace a selection the user no longer has", async () => {
    const { host, calls } = fakeHost();
    const session = createSession();
    await readWritingContext(host, session);

    // The user clicked away mid-turn: the highlight the model wrote a
    // span-sized replacement for is gone.
    host.remixGetContext = async () => ({
      ok: true,
      appName: "Pages",
      windowTitle: "Draft",
      url: null,
      selection: null,
      target: { status: "empty" },
      preciseSelection: true,
    });

    const result = await applyText(host, session, {
      target: "selection",
      text: "replacement",
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("target-changed");
    expect(calls.some((call) => call.startsWith("pasteText"))).toBe(false);
  });

  it("refuses to write into a document that is not the one it read", async () => {
    const { host, calls } = fakeHost();
    const session = createSession();
    await readWritingContext(host, session);

    host.remixGetContext = async () => ({
      ok: true,
      appName: "Slack",
      windowTitle: "general",
      url: null,
      selection: "something else",
      target: { status: "selected", text: "something else" },
      preciseSelection: true,
    });

    const result = await applyText(host, session, {
      target: "selection",
      text: "the reply",
    });

    expect(result.reason).toBe("target-changed");
    expect(calls.some((call) => call.startsWith("pasteText"))).toBe(false);
  });

  it("refuses to replace a different selection in the same document", async () => {
    const { host, calls } = fakeHost();
    const session = createSession();
    await readWritingContext(host, session);

    host.remixGetContext = async () => ({
      ok: true,
      appName: "Pages",
      windowTitle: "Draft",
      url: null,
      selection: "a different sentence",
      target: { status: "selected", text: "a different sentence" },
      preciseSelection: true,
    });

    const result = await applyText(host, session, {
      target: "selection",
      text: "replacement",
    });

    expect(result.reason).toBe("target-changed");
    expect(calls.some((call) => call.startsWith("pasteText"))).toBe(false);
  });

  it("never writes when the target could not be read", async () => {
    const { host, calls } = fakeHost({
      remixGetContext: async () => ({
        ok: true,
        appName: "Pages",
        windowTitle: "Draft",
        url: null,
        selection: null,
        target: { status: "unavailable", reason: "no-accessibility" },
        preciseSelection: false,
      }),
    });

    const result = await applyText(host, createSession(), {
      target: "cursor",
      text: "anything",
    });

    expect(result.reason).toBe("target-unavailable");
    expect(calls.some((call) => call.startsWith("pasteText"))).toBe(false);
  });

  it("reports an ambiguous anchor with its match count and writes nothing", async () => {
    const { host, calls } = fakeHost({
      remixSelectText: async () => ({
        ok: false,
        reason: "ambiguous",
        matches: 3,
      }),
    });

    const result = await applyText(host, createSession(), {
      target: "anchored-passage",
      text: "rewritten",
      anchor: "the paragraph",
    });

    expect(result).toMatchObject({ reason: "anchor-ambiguous", matches: 3 });
    expect(calls.some((call) => call.startsWith("pasteText"))).toBe(false);
  });

  it("leaves the document alone for a clipboard-only write", async () => {
    const { host, calls } = fakeHost();

    const result = await applyText(host, createSession(), {
      target: "clipboard",
      text: "just copy this",
    });

    expect(result).toEqual({ ok: true, applied: "clipboard" });
    expect(calls.some((call) => call.startsWith("pasteText"))).toBe(false);
    expect(calls).not.toContain("getContext");
  });

  it("enforces the smaller document-write limit on the client", async () => {
    const { host, calls } = fakeHost();

    const result = await applyText(host, createSession(), {
      target: "cursor",
      text: "x".repeat(20_001),
    });

    expect(result.reason).toBe("bad-args");
    expect(calls).toEqual([]);
  });
});

describe("insert_image", () => {
  it("never inserts when the target is unavailable", async () => {
    const { host, calls } = fakeHost({
      remixGetContext: async () => ({
        ok: true,
        appName: "Pages",
        windowTitle: "Draft",
        url: null,
        selection: null,
        target: { status: "unavailable", reason: "no-accessibility" },
        preciseSelection: false,
      }),
    });

    const result = await insertImage(
      host,
      createSession(),
      "https://example.com/image.png",
    );

    expect(result.reason).toBe("target-unavailable");
    expect(calls.some((call) => call.startsWith("pasteImage"))).toBe(false);
  });
});

describe("undo_last_remix", () => {
  it("refuses when there is no edit of ours to take back", async () => {
    const { host, calls } = fakeHost();

    const result = await undoLastRemix(host, createSession());

    // Native undo would happily keep going into the user's own work.
    expect(result).toMatchObject({ ok: false, reason: "nothing-to-undo" });
    expect(calls).not.toContain("undo");
  });

  it("undoes once and then refuses again", async () => {
    const { host } = fakeHost();
    const session = createSession();
    await applyText(host, session, { target: "cursor", text: "x" });

    expect(await undoLastRemix(host, session)).toEqual({ ok: true });
    expect(await undoLastRemix(host, session)).toMatchObject({
      ok: false,
      reason: "nothing-to-undo",
    });
  });
});

describe("the loop breaker", () => {
  it("stops running a call that has already failed the same way twice", async () => {
    const { host } = fakeHost({
      remixSelectText: async () => ({ ok: false, reason: "not-found" }),
    });
    const session = createSession();
    const input = { target: "anchored-passage", anchor: "gone", text: "new" };

    // Twice is a retry, and often the right move — an anchor gets mistyped.
    for (let i = 0; i < REMIX_REPEAT_FAILURE_LIMIT; i++) {
      expect(
        await runRemixTool(host, session, "apply_text", { ...input }),
      ).toMatchObject({ ok: false, reason: "anchor-not-found" });
    }

    // The third is a circuit. Nothing we could return would break it, because
    // the model already has that result twice — so the host stops answering
    // with the same thing and says plainly that retrying cannot work.
    const broken = await runRemixTool(host, session, "apply_text", {
      ...input,
    });
    expect(broken).toMatchObject({
      ok: false,
      reason: "repeated-failure",
      retryable: false,
    });

    // Different arguments are a different attempt, not a continuation.
    host.remixSelectText = async () => ({ ok: true });
    expect(
      await runRemixTool(host, session, "apply_text", {
        ...input,
        anchor: "the old sentence",
      }),
    ).toMatchObject({ ok: true });
  });

  it("caps identical successful calls without punishing a second look", async () => {
    const { host } = fakeHost();
    const session = createSession();

    // A long piece of work legitimately re-reads the same context between
    // passes, so a repeat success is not treated as a loop on sight.
    expect(
      await runRemixTool(host, session, "read_writing_context", {}),
    ).toMatchObject({ ok: true });
    expect(
      await runRemixTool(host, session, "read_writing_context", {}),
    ).toMatchObject({ ok: true });

    let result = await runRemixTool(host, session, "read_writing_context", {});
    while (result.ok === true) {
      result = await runRemixTool(host, session, "read_writing_context", {});
    }
    expect(result).toMatchObject({
      ok: false,
      reason: "repeated-call",
      retryable: false,
    });

    beginRemixTurn(session);
    expect(
      await runRemixTool(host, session, "read_writing_context", {}),
    ).toMatchObject({ ok: true });
  });
});

