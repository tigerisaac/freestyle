/**
 * A document that can actually be damaged.
 *
 * The composer's tests used to assert on the order the host was driven in —
 * "collapse came before pasteText" — because the fake host was a set of
 * recorders that returned `{ ok: true }` and held no state. That catches a
 * mis-sequenced recipe, and it is completely blind to the failure that
 * actually shipped: text arriving twice. A recorder cannot tell you that the
 * document now contains two copies of the same paragraph, because it does not
 * contain anything.
 *
 * So this is a real editor, in miniature: a string, a selection, an undo
 * stack, and the same operations the IPC layer exposes. Drive it with the
 * composer and afterwards you can read the document and ask the only question
 * that ever mattered — is what the user asked for in there, exactly once?
 *
 * Test-only. Nothing in the shipped renderer imports it.
 */

import type { RemixHost } from "./remix-composites";

export interface DocumentSimOptions {
  /** Starting document text. */
  text?: string;
  /** Initial selection, as [start, end). Collapsed cursor when start === end. */
  selection?: [number, number];
  appName?: string;
  windowTitle?: string;
  /**
   * Whether the app supports the accessibility read. False models a canvas
   * editor (Google Docs, Notion), where reading the document means select-all
   * + copy — which destroys the user's highlight and is why the composer has
   * to collapse afterwards.
   */
  preciseSelection?: boolean;
  /**
   * Where the cursor lands after a paste. Most editors collapse to the end of
   * the pasted text; some rich editors leave it selected. The composer's
   * revision path has to work either way, so both are modelled.
   */
  afterPaste?: "collapse" | "keep-selected";
  /**
   * Reads longer than this come back truncated. This is the condition that
   * made the old correction gate unsatisfiable, so it is worth being able to
   * reproduce on purpose.
   */
  readLimit?: number;
  /** Simulates the selection being unreadable (no Accessibility permission). */
  targetUnavailable?: boolean;
  /**
   * The readable text of the window around the field — the email above a
   * reply box, the thread above a chat input. Undefined models an app whose
   * window cannot be read at all.
   */
  surroundings?: string;
}

/** An editor small enough to assert on and faithful enough to be damaged. */
export class DocumentSim {
  text: string;
  selStart: number;
  selEnd: number;
  appName: string;
  windowTitle: string;
  preciseSelection: boolean;
  targetUnavailable: boolean;
  surroundings?: string;
  clipboard = "";
  /** Every paste, in order — the record duplication shows up in. */
  pastes: string[] = [];
  private readonly afterPaste: "collapse" | "keep-selected";
  private readonly readLimit: number;
  private readonly undoStack: {
    text: string;
    selStart: number;
    selEnd: number;
  }[] = [];

  constructor(options: DocumentSimOptions = {}) {
    this.text = options.text ?? "";
    const [start, end] = options.selection ?? [0, 0];
    this.selStart = start;
    this.selEnd = end;
    this.appName = options.appName ?? "Pages";
    this.windowTitle = options.windowTitle ?? "Draft";
    this.preciseSelection = options.preciseSelection ?? true;
    this.targetUnavailable = options.targetUnavailable ?? false;
    this.surroundings = options.surroundings;
    this.afterPaste = options.afterPaste ?? "collapse";
    this.readLimit = options.readLimit ?? Number.POSITIVE_INFINITY;
  }

  get selection(): string {
    return this.text.slice(this.selStart, this.selEnd);
  }

  /** How many times `needle` appears — the duplication assertion. */
  countOf(needle: string): number {
    if (!needle) return 0;
    let count = 0;
    let at = this.text.indexOf(needle);
    while (at !== -1) {
      count++;
      at = this.text.indexOf(needle, at + needle.length);
    }
    return count;
  }

  private truncate(value: string): { text: string; truncated: boolean } {
    return value.length > this.readLimit
      ? { text: value.slice(0, this.readLimit), truncated: true }
      : { text: value, truncated: false };
  }

  private snapshot(): void {
    this.undoStack.push({
      text: this.text,
      selStart: this.selStart,
      selEnd: this.selEnd,
    });
  }

  /** The `RemixHost` face of this document, for handing to the composer. */
  host(): RemixHost {
    return {
      remixGetContext: async () => ({
        ok: true,
        appName: this.appName,
        windowTitle: this.windowTitle,
        url: null,
        selection: this.targetUnavailable
          ? null
          : this.selStart === this.selEnd
            ? null
            : this.selection,
        target: this.targetUnavailable
          ? { status: "unavailable" as const, reason: "no-accessibility" }
          : this.selStart === this.selEnd
            ? { status: "empty" as const }
            : { status: "selected" as const, text: this.selection },
        preciseSelection: this.preciseSelection,
      }),

      remixReadDocument: async () => {
        if (!this.preciseSelection) {
          return { ok: false, reason: "unsupported" };
        }
        const read = this.truncate(this.text);
        return {
          ok: true,
          text: read.text,
          truncated: read.truncated,
          selStart: this.selStart,
          selLen: this.selEnd - this.selStart,
        };
      },

      remixReadSurroundings: async () => {
        if (this.surroundings === undefined) {
          return { ok: false, reason: "unsupported" };
        }
        const read = this.truncate(this.surroundings);
        return { ok: true, text: read.text, truncated: read.truncated };
      },

      remixSelectAll: async () => {
        this.selStart = 0;
        this.selEnd = this.text.length;
        return { ok: true };
      },

      remixSelectText: async (needle: string, occurrence?: number) => {
        const matches = this.countOf(needle);
        if (matches === 0) return { ok: false, reason: "not-found" };
        if (matches > 1 && occurrence === undefined) {
          return { ok: false, reason: "ambiguous", matches };
        }
        const wanted = occurrence ?? 1;
        if (wanted > matches) return { ok: false, reason: "not-found" };
        let at = -1;
        for (let i = 0; i < wanted; i++) {
          at = this.text.indexOf(needle, at === -1 ? 0 : at + needle.length);
        }
        this.selStart = at;
        this.selEnd = at + needle.length;
        return { ok: true };
      },

      remixCollapseSelection: async () => {
        this.selStart = this.selEnd;
        return { ok: true };
      },

      remixCopy: async () => {
        if (this.selStart === this.selEnd) {
          return { ok: false, reason: "nothing-copied" };
        }
        const read = this.truncate(this.selection);
        this.clipboard = read.text;
        return { ok: true, text: read.text, truncated: read.truncated };
      },

      remixGetClipboard: async () => {
        const read = this.truncate(this.clipboard);
        return { ok: true, text: read.text, truncated: read.truncated };
      },

      remixSetClipboard: async (value: string) => {
        this.clipboard = value;
        return { ok: true };
      },

      remixSetClipboardImage: async () => ({ ok: true }),

      remixPasteClipboard: async () => {
        this.paste(this.clipboard);
        return { ok: true };
      },

      // The clipboard-preserving transaction: the host stages, pastes, and
      // puts the user's clipboard back, so the simulated clipboard is
      // deliberately left untouched here.
      remixPasteText: async (value: string) => {
        this.paste(value);
        return { ok: true };
      },

      remixPasteImage: async () => {
        this.paste("￼");
        return { ok: true };
      },

      remixUndo: async () => {
        const previous = this.undoStack.pop();
        if (!previous) return { ok: false, reason: "nothing-to-undo" };
        this.text = previous.text;
        this.selStart = previous.selStart;
        this.selEnd = previous.selEnd;
        return { ok: true };
      },
    };
  }

  /** Paste semantics, which are the whole reason this class exists: the
   * pasted text REPLACES the selection. An insert into a live highlight
   * silently destroys it, and an insert at a collapsed cursor adds. */
  private paste(value: string): void {
    this.snapshot();
    this.text =
      this.text.slice(0, this.selStart) + value + this.text.slice(this.selEnd);
    this.pastes.push(value);
    if (this.afterPaste === "keep-selected") {
      this.selEnd = this.selStart + value.length;
    } else {
      this.selStart += value.length;
      this.selEnd = this.selStart;
    }
  }
}
