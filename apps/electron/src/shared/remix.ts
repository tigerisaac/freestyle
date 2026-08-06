/**
 * Single source of truth for the remix hotkey default, mirroring
 * `hotkey-defaults.ts` for dictation.
 *
 * - macOS: Fn (Globe) + Control. Two modifiers and no letter, which is what
 *   keeps it clear of the Globe shortcuts macOS already owns — Globe+C is
 *   Control Center, Globe+E is emoji, Globe+F is fullscreen, and so on down
 *   the alphabet. It also shares its home key with dictation's solo Fn, so the
 *   two live under the same finger.
 * - Windows/Linux: Control+Alt+E, matching the dictation default's modifiers.
 *   A real key rather than a bare chord, because the native listeners on those
 *   platforms suppress a named key, not a modifier combination.
 *
 * Imported by the main process and the preload script (which exposes it to the
 * renderer as `window.api.defaultRemixHotkey`).
 */
export function getDefaultRemixHotkey(
  platform: string = process.platform,
): string {
  switch (platform) {
    case "darwin":
      return "Fn+Control";
    default:
      return "Control+Alt+E";
  }
}

/**
 * How long the key must be down to count as a hold, and so as speech. Below
 * this the press is a tap: the card opens on its own, showing the routes and
 * their digits, and nothing is recorded. The threshold matches the one
 * dictation uses to throw away an accidental tap, so the two hotkeys feel the
 * same under the finger.
 */
export const REMIX_HOLD_THRESHOLD_MS = 250;

/**
 * How long a tapped-open card waits, untouched, before dismissing itself.
 *
 * Not merely tidiness: the route digits are held as global shortcuts for as
 * long as the card is up, so this is the bound on how long they can be taken
 * from the rest of the system. A card left open behind a full-screen window
 * would otherwise keep them indefinitely.
 */
export const REMIX_IDLE_MS = 12_000;

/**
 * How long the chat card keeps an idle thread on screen. Much longer than the
 * preset card's idle window — a conversation is something the user comes back
 * to — and matched by the server's thread-decay window, so the card and the
 * stored thread age out together.
 */
export const REMIX_CHAT_IDLE_MS = 15 * 60 * 1000;

/**
 * What the hotkey press found under the cursor.
 *
 * Three states, not two, because "nothing is highlighted" and "we couldn't
 * read what's highlighted" call for opposite behaviour and a `string | null`
 * cannot tell them apart. An empty selection is a perfectly good target — it
 * means compose at the cursor — while an unreadable one is no target at all,
 * and writing into it means writing somewhere the user never pointed.
 */
export type RemixSelectionState =
  | { status: "selected"; text: string }
  | { status: "empty" }
  | { status: "unavailable"; reason: string };

/** The selected text, or null in either of the other two states. */
export function selectionText(state: RemixSelectionState): string | null {
  return state.status === "selected" ? state.text : null;
}

/**
 * Whether the agent may write into this target unasked.
 *
 * True for both affirmative states — a highlight is replaced, a caret is
 * written at — and false only when capture failed, which is the case the type
 * exists to keep separable.
 */
export function canWriteToTarget(state: RemixSelectionState): boolean {
  return state.status !== "unavailable";
}

/**
 * How the target reads in the pill, per the spec's three summon states.
 *
 * `empty` deliberately does not phrase itself as an absence. "No selection"
 * reads like something went wrong, and users who saw it stopped and went
 * looking for text to highlight — when in fact an empty caret is the second
 * of the two things the hotkey is for. "Writing at cursor" says what will
 * happen instead of what is missing.
 *
 * Words rather than characters because a word count is the unit writers
 * already think in, and it is the one that tells them at a glance whether the
 * highlight they made is the one they meant.
 */
export function describeRemixTarget(state: RemixSelectionState): string {
  switch (state.status) {
    case "selected": {
      const words = countWords(state.text);
      return `Editing selection · ${words} ${words === 1 ? "word" : "words"}`;
    }
    case "empty":
      return "Writing at cursor";
    case "unavailable":
      return "Couldn’t read selection";
  }
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** What one hotkey press captured: the selection plus its anchor. */
export interface RemixSelectionPayload {
  /**
   * The captured text, or null when nothing was highlighted or the read
   * failed. Retained beside `target` so existing readers keep working;
   * `target` is what anything deciding *where to write* must consult.
   */
  text: string | null;
  /** The tri-state reading of the same capture. */
  target: RemixSelectionState;
  appName: string | null;
  windowTitle: string | null;
  /** Active browser tab URL when the anchor is a browser (Docs routing). */
  url?: string | null;
  /** Preview of the user's clipboard text (capped), and its full length —
   * "edit this" with nothing highlighted usually means the clipboard. */
  clipboard?: string | null;
  clipboardLength?: number;
  capturedAt: number;
}

/** A re-capture for a typed follow-up. `stale` means the pill had focus. */
export interface RemixRecapturePayload {
  selection: string | null;
  /**
   * The tri-state reading of this re-capture. Absent when `stale` — a
   * re-capture taken while the pill held focus never asked the document
   * anything, so it has no verdict to offer about the target.
   */
  target?: RemixSelectionState;
  appName: string | null;
  windowTitle: string | null;
  url?: string | null;
  clipboard?: string | null;
  clipboardLength?: number;
  capturedAt: number;
  stale: boolean;
}

/** Result of one primitive action against the user's machine. */
export interface RemixPrimitiveResult {
  ok: boolean;
  /** Short machine-readable failure, e.g. "document-not-in-front". */
  reason?: string;
}

/** get_context: the machine as it is right now. */
export interface RemixContextResult extends RemixPrimitiveResult {
  appName: string | null;
  windowTitle: string | null;
  url: string | null;
  selection: string | null;
  /** The tri-state reading of `selection`. */
  target?: RemixSelectionState;
  /** Whether select_text can place the selection precisely in this app. */
  preciseSelection?: boolean;
  /** The focused document's character count, when the app exposes it. */
  docLength?: number | null;
  /** Preview of the user's clipboard text (capped) and its full length. */
  clipboardPreview?: string | null;
  clipboardLength?: number;
}

/** read_document: the whole document via accessibility, highlight intact. */
export interface RemixReadDocumentResult extends RemixPrimitiveResult {
  text?: string;
  truncated?: boolean;
  /** The current selection's range within the text (UTF-16 offsets). */
  selStart?: number;
  selLen?: number;
}

/**
 * read-surroundings: the whole focused window's readable text.
 *
 * Distinct from `RemixReadDocumentResult` because it carries no selection
 * offsets — there is no single field being described, which is the point.
 */
export interface RemixSurroundingsResult extends RemixPrimitiveResult {
  text?: string;
  truncated?: boolean;
}

/** copy: the selection's text, capped for the model. */
export interface RemixCopyResult extends RemixPrimitiveResult {
  text?: string;
  truncated?: boolean;
}

/** select_text: whether precise selection landed. */
export interface RemixSelectResult extends RemixPrimitiveResult {
  reason?:
    | "unsupported"
    | "not-found"
    | "ambiguous"
    | "failed"
    | "document-not-in-front";
  /** How many occurrences exist, on ambiguous / out-of-range results. */
  matches?: number;
}

/** How much clipboard text travels as ambient context; get_clipboard has it all. */
export const REMIX_CLIPBOARD_PREVIEW_LIMIT = 300;
