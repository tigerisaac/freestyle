import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../src/lib/db.js";
import {
  forgetInThread,
  getThreadMemory,
  MEMORY_PROMPT_CHAR_BUDGET,
  rememberInThread,
  renderThreadMemory,
} from "../src/lib/remix-memory.js";

function newThread(): number {
  const db = getDb();
  db.prepare("INSERT INTO remix_threads DEFAULT VALUES").run();
  const row = db
    .prepare("SELECT id FROM remix_threads ORDER BY id DESC LIMIT 1")
    .get() as { id: number };
  return row.id;
}

let threadId: number;
beforeEach(() => {
  threadId = newThread();
});

describe("thread writing memory", () => {
  it("keeps one brief per piece, replacing rather than accumulating", () => {
    // A second brief is a revision, not an addition — otherwise the prompt
    // ends up carrying two contradictory statements of what the piece is for.
    rememberInThread(threadId, "brief", "A guide to local speech models.");
    rememberInThread(threadId, "brief", "A guide to on-device transcription.");

    const briefs = getThreadMemory(threadId).filter((e) => e.kind === "brief");
    expect(briefs).toHaveLength(1);
    expect(briefs[0].content).toBe("A guide to on-device transcription.");
  });

  it("accumulates facts but drops the oldest past the ceiling", () => {
    for (let i = 1; i <= 25; i++) {
      rememberInThread(threadId, "fact", `fact number ${i}`);
    }

    const facts = getThreadMemory(threadId).filter((e) => e.kind === "fact");
    // A memory that no longer fits the prompt is not memory.
    expect(facts).toHaveLength(20);
    expect(facts.some((f) => f.content === "fact number 25")).toBe(true);
    expect(facts.some((f) => f.content === "fact number 1")).toBe(false);
  });

  it("does not spend a slot re-recording the same thing", () => {
    rememberInThread(threadId, "fact", "Whisper large-v3 is 1.55B parameters.");
    rememberInThread(threadId, "fact", "Whisper large-v3 is 1.55B parameters.");

    expect(getThreadMemory(threadId)).toHaveLength(1);
  });

  it("refuses empty and oversized entries", () => {
    expect(rememberInThread(threadId, "fact", "   ").ok).toBe(false);
    expect(rememberInThread(threadId, "brief", "x".repeat(2_001)).ok).toBe(
      false,
    );
    expect(getThreadMemory(threadId)).toHaveLength(0);
  });

  it("keeps threads separate", () => {
    const other = newThread();
    rememberInThread(threadId, "brief", "mine");
    rememberInThread(other, "brief", "theirs");

    expect(getThreadMemory(threadId)[0].content).toBe("mine");
    expect(getThreadMemory(other)[0].content).toBe("theirs");
  });

  it("forgets a single entry without touching the rest", () => {
    rememberInThread(threadId, "fact", "one");
    rememberInThread(threadId, "fact", "two");
    const [first] = getThreadMemory(threadId);

    expect(forgetInThread(threadId, first.id)).toBe(true);
    const left = getThreadMemory(threadId);
    expect(left).toHaveLength(1);
    expect(left[0].content).toBe("two");
  });
});

describe("rendering memory for the prompt", () => {
  it("renders nothing when there is nothing to carry", () => {
    expect(renderThreadMemory([])).toBe("");
  });

  it("marks earlier agent summaries as context rather than instructions", () => {
    rememberInThread(threadId, "brief", "A guide to local speech models.");
    const rendered = renderThreadMemory(getThreadMemory(threadId));

    // The prompt has three kinds of third-party-ish text in it — quoted
    // document content, vendored craft guidance, and this. Only this one is
    // the user's decision, and it has to be unmistakable.
    expect(rendered).toContain("not as new instructions");
    expect(rendered).toContain("may be incomplete or mistaken");
    expect(rendered).toContain("The user's current message");
    expect(rendered).toContain("A guide to local speech models.");
  });

  it("groups by kind with the brief first", () => {
    rememberInThread(threadId, "open-question", "Does MLX support batching?");
    rememberInThread(threadId, "fact", "Parakeet runs at 0.6B parameters.");
    rememberInThread(threadId, "brief", "A guide to local speech models.");

    const rendered = renderThreadMemory(getThreadMemory(threadId));

    expect(rendered.indexOf("What this piece is for")).toBeLessThan(
      rendered.indexOf("Established facts"),
    );
    expect(rendered.indexOf("Established facts")).toBeLessThan(
      rendered.indexOf("Still unresolved"),
    );
  });

  it("stays small enough to carry on every turn", () => {
    // The whole point is to be cheaper than re-reading the document. A full
    // memory must not itself become the thing that blows the budget.
    rememberInThread(threadId, "brief", "x ".repeat(100));
    rememberInThread(threadId, "outline", "y ".repeat(200));
    for (let i = 0; i < 30; i++) {
      rememberInThread(threadId, "fact", `fact ${i} ${"z ".repeat(20)}`);
      rememberInThread(threadId, "source", `https://example.com/${i}`);
      rememberInThread(threadId, "open-question", `question ${i}`);
    }

    const words = renderThreadMemory(getThreadMemory(threadId)).split(
      /\s+/,
    ).length;
    expect(words).toBeLessThan(1_500);
    expect(
      renderThreadMemory(getThreadMemory(threadId)).length,
    ).toBeLessThanOrEqual(MEMORY_PROMPT_CHAR_BUDGET);
  });

  it("enforces the total budget even when every slot holds a maximum entry", () => {
    rememberInThread(threadId, "brief", "b".repeat(2_000));
    rememberInThread(threadId, "outline", "o".repeat(2_000));
    for (let i = 0; i < 20; i++) {
      rememberInThread(threadId, "fact", `${i}:${"f".repeat(1_995)}`);
    }

    const rendered = renderThreadMemory(getThreadMemory(threadId));
    expect(rendered.length).toBeLessThanOrEqual(MEMORY_PROMPT_CHAR_BUDGET);
    expect(rendered).toContain("omitted to stay within the prompt budget");
  });
});
