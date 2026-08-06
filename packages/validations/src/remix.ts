import { z } from "zod/v3";

/**
 * Remix: the AI writing agent on the cursor. Two lanes share these contracts:
 *
 * - Transform (fast lane): preset or short spoken instruction over a captured
 *   selection, one-shot LLM call, result pasted over the selection.
 * - Agent (chat lane): a tool-using agent loop. Server-side tools run on
 *   Freestyle Cloud; client-side tools (declared here, executed on the
 *   desktop) write into the user's document.
 *
 * This file is mirrored byte-for-byte (below the header) into the cloud
 * repo's `packages/validations/src/remix.ts` — the same parity rule as
 * `cleanup-presets.ts`. Change both or change neither.
 */

export interface RemixPreset {
  id: string;
  /** Shown in the pill's route strip. Keep it to one word where possible. */
  label: string;
  /**
   * What the model is told to do. Written as an instruction to an editor
   * working on someone else's text, because that's exactly what it is — the
   * selection is quoted content, never a prompt.
   */
  instruction: string;
}

/**
 * The routes, in the order they are drawn. Three, on one row: the edits
 * people ask for without thinking. A fourth would start a second row and turn
 * a glanceable strip into a list to be read.
 */
export const REMIX_PRESETS: readonly RemixPreset[] = [
  {
    id: "fix",
    label: "Fix",
    instruction:
      "Correct grammar, spelling, and punctuation errors. Preserve the author's wording, voice, structure, and level of formality exactly — change only what is actually wrong. If the text contains no errors, return it unchanged.",
  },
  {
    id: "formal",
    label: "Formal",
    instruction:
      "Rewrite the text in a professional register suitable for work correspondence: complete sentences, no slang, measured tone, nothing curt. Keep the meaning, the substance, and the author's actual position identical — this is a change of register, not of content.",
  },
  {
    id: "markdown",
    label: "Markdown",
    instruction:
      "Format the text as Markdown, using the structure the text already has: headings for what reads as a heading, `-` bullets or numbered items for what reads as a list, `**bold**` for what is emphasised, and backticks for code, paths, and commands. Keep the wording as it is — this is formatting, not rewriting. Do not wrap the whole result in a code fence.",
  },
] as const;

export function findRemixPreset(id: string): RemixPreset | undefined {
  return REMIX_PRESETS.find((preset) => preset.id === id);
}

/**
 * A transform run. Exactly one of `remixId` (a preset) or `instruction` (what
 * the user said) identifies the edit; the route rejects a body carrying
 * neither, since "edit this somehow" isn't an edit.
 */
export const remixTransformSchema = z
  .object({
    // Non-blank, but the caller's whitespace is preserved verbatim — the
    // selection is pasted back over itself, so leading/trailing space is part
    // of what the user picked.
    text: z
      .string()
      .refine((v) => v.trim().length > 0, "text field is required"),
    remixId: z.string().optional(),
    instruction: z.string().optional(),
    language: z.string().optional(),
    appName: z.string().max(200).nullish(),
  })
  .refine(
    (v) => !!v.remixId || !!v.instruction?.trim(),
    "either remixId or instruction is required",
  );

export type RemixTransformInput = z.infer<typeof remixTransformSchema>;

// ---------------------------------------------------------------------------
// Agent lane
// ---------------------------------------------------------------------------

/**
 * What the capture found under the cursor, as three states rather than two.
 *
 * `selection: null` cannot say whether nothing was highlighted or nothing
 * could be read, and the agent needs to behave oppositely in those two cases:
 * an empty target invites composition at the cursor, an unreadable one is not
 * a target at all and nothing may be written until it is recovered.
 *
 * Only the status travels — the text itself is already `selection`.
 */
export const remixTargetSchema = z.enum(["selected", "empty", "unavailable"]);

export type RemixTarget = z.infer<typeof remixTargetSchema>;

/** Everything the desktop captured about where the user is writing. */
export const remixContextSchema = z.object({
  /** The highlighted text, verbatim. Null when nothing was selected. */
  selection: z.string().max(100_000).nullable(),
  /**
   * Optional so that a desktop older than this field still validates; it is
   * inferred from `selection` when absent, which reproduces the previous
   * two-state behaviour exactly.
   */
  target: remixTargetSchema.optional(),
  appName: z.string().max(200).nullable(),
  windowTitle: z.string().max(500).nullable(),
  /** ISO codes of the user's languages; the agent must not translate. */
  languages: z.array(z.string()).optional(),
  /** Preview of the user's clipboard text and its full length — "edit this"
   * with nothing highlighted usually means the clipboard. */
  clipboard: z.string().max(500).nullable().optional(),
  clipboardLength: z.number().int().optional(),
  /**
   * What this thread's work has accumulated — brief, outline, established
   * facts — rendered by the desktop, which is where it is stored. Injected by
   * the local server rather than sent by the renderer; Freestyle Cloud
   * receives it for one request and keeps none of it.
   */
  memory: z.string().max(20_000).optional(),
  /** Epoch ms of capture — lets the agent reason about staleness. */
  capturedAt: z.number(),
});

export type RemixContext = z.infer<typeof remixContextSchema>;

/**
 * Which writing skills this user allows, travelling with the request.
 *
 * On the wire rather than read from a server-side store because only the
 * desktop knows the user's settings, and because it makes the cloud and BYOK
 * paths take the identical decision from the identical input — which is the
 * parity §6.1 asks CI to enforce.
 */
export const remixSkillPrefsSchema = z.object({
  /** The whole skill layer is off unless this is true. */
  enabled: z.boolean(),
  /** Broad categories the user switched off in settings. */
  disabledCategories: z
    .array(
      z.enum([
        "clarity",
        "professional",
        "creative",
        "marketing",
        "academic",
        "long-form",
      ]),
    )
    .optional(),
  /** A skill the user pinned for this request from the chip's override menu. */
  preferredSkillId: z.string().max(100).optional(),
});

export type RemixSkillPrefs = z.infer<typeof remixSkillPrefsSchema>;

/**
 * One agent request. The server is stateless: `messages` is the full
 * UIMessage thread and IS the conversation state. UIMessage's shape belongs
 * to the AI SDK — validating it structurally here would chase SDK versions,
 * so the array passes through and `convertToModelMessages` is the validator.
 */
export const remixAgentRequestSchema = z.object({
  messages: z.array(z.unknown()).min(1).max(80),
  context: remixContextSchema,
  /** Absent from an older desktop, which means the skill layer stays off. */
  skills: remixSkillPrefsSchema.optional(),
});

export type RemixAgentRequest = z.infer<typeof remixAgentRequestSchema>;

/** Caps re-checked by the desktop before anything touches the document. */
export const REMIX_WRITE_LIMIT = 20_000;
export const REMIX_CLIPBOARD_LIMIT = 100_000;

/**
 * Client-side tools: composite, not primitive.
 *
 * These used to be thirteen one-keystroke primitives — select_all, copy,
 * set_clipboard, paste, press_key — and the system prompt carried the recipes
 * for combining them: which order, what to collapse first, when the highlight
 * was sacred, how to verify. That cost roughly two thousand words of tool
 * descriptions and as much again in prompt, on every single request, to
 * re-teach the model a procedure that never varies.
 *
 * It also put the document's safety in the model's hands. "Never end your
 * turn with the document fully selected" is a rule that works until the one
 * turn it doesn't, and the failure mode is the user's work replaced by a
 * paste that landed in a select-all.
 *
 * So the recipes moved into the host, which can actually enforce them. The
 * primitives still exist behind these three tools — the composer in the
 * renderer drives exactly the same IPC as before — but the model no longer
 * sees them, cannot sequence them wrongly, and does not pay for their
 * descriptions. What it sees is the capability: read the context, apply text
 * to a target, undo.
 *
 * The names are the wire contract — the cloud route, the local BYOK loop,
 * and the renderer's composer all switch on them.
 */
export const REMIX_CLIENT_TOOLS = {
  read_writing_context: {
    description:
      "Look at what the user is writing, right now, and at what is around it. Returns { ok, appName, windowTitle, url, target, selection, text?, clipboard?, surroundings?, truncated?, preciseSelection, generation, next }. `target` is the crucial field and is one of: 'selected' (the user has highlighted a span — `selection` holds it, and apply_text with target 'selection' replaces exactly that), 'empty' (a plain cursor — a valid destination, not a problem: apply_text with target 'cursor' inserts there), or 'unavailable' (the selection could NOT be read — this is not an empty target, so do not write anything; tell the user to click back into their document). Reading the highlight can cost a keystroke in the user's document, so call this once at the start of a task that depends on what is highlighted, and again only after the user may have changed something. Failure: { ok: false, reason: 'document-not-in-front' } — the user's document is no longer frontmost; ask them to click back into it.",
    inputSchema: z.object({
      scope: z
        .enum([
          "selection",
          "document",
          "near-cursor",
          "clipboard",
          "surroundings",
        ])
        .optional()
        .describe(
          "What to read. 'selection' (default) — just the highlight and where the user is; the cheapest, and all a highlighted edit needs. 'document' — the whole document in `text`, for when you must locate a passage the user did not highlight, or match the surrounding voice. 'near-cursor' — the passage around the cursor, for continuing prose without reading a long document. 'clipboard' — the current clipboard text in `clipboard`, when its preview was truncated or the user explicitly referred to it. 'surroundings' — the readable text of the whole WINDOW in `surroundings`, including what is outside the field being typed into. This is the one that answers 'reply to this': the message being replied to is never inside the reply box, so a 'document' read of a compose field returns an empty draft no matter how often you repeat it. Use it whenever the task refers to something on screen you cannot otherwise see — an email, a chat thread, a form, a page. It returns interface text too (menus, tab titles), so read past that to the content. Ask for the least you need: document, clipboard and surroundings reads can be tens of thousands of characters.",
        ),
    }),
  },
  apply_text: {
    description:
      "Write text into the user's document. This is the ONLY way to change their document, and it is one atomic step: the host positions the target, puts the text in place, restores the user's clipboard, and records the edit so undo_last_remix can reverse it. Returns { ok, applied, reason? }. You do not manage the clipboard, the selection, or the cursor — describe the destination with `target` and the host does the rest, including refusing stale targets. Write once and completely where you can. Writing again in the same turn is safe rather than forbidden: the host replaces your own previous output instead of leaving a second copy beside it, and re-sending text you already wrote is a no-op. So revise when you have a reason to, and stop when the document says what the user asked for. Every failure carries `next`, which says exactly what to do about it, and `retryable`. When `retryable` is false no version of that call will succeed: say what happened in one sentence and let the user decide. Never repeat a call whose arguments already failed. A failure means nothing was written.",
    inputSchema: z
      .object({
        target: z
          .enum([
            "selection",
            "cursor",
            "document",
            "anchored-passage",
            "clipboard",
          ])
          .describe(
            "Where the text goes. 'selection' — replace exactly what the user highlighted; it can never mean the whole document, even when your `text` contains a complete rewrite. 'cursor' — insert at the cursor, replacing nothing; this is the default for composing new content. 'document' — replace the entire document exactly; use only after read_writing_context with scope 'document' returned the complete current text. 'anchored-passage' — replace a passage the user did NOT highlight, identified by `anchor`. 'clipboard' — put the text on the clipboard and do not touch the document at all; use ONLY when the user explicitly said not to write ('copy it', 'don't paste').",
          ),
        text: z
          .string()
          .min(1)
          .max(REMIX_CLIPBOARD_LIMIT)
          .describe(
            "The final text, exactly as it should appear in the document: no preamble, no commentary, no wrapping quotes, no code fence unless the original had one. Document writes are capped at 20,000 characters; the larger limit is only for an explicit clipboard-only result. Any unchanged text you are rewriting around must be reproduced character-for-character from what you actually read — never from memory.",
          ),
        anchor: z
          .string()
          .min(1)
          .max(REMIX_WRITE_LIMIT)
          .optional()
          .describe(
            "Required when target is 'anchored-passage': the exact existing passage to replace, copied character-for-character from a read of the document. Not a search query — no regex, no paraphrase, no ellipses.",
          ),
        occurrence: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe(
            "When `anchor` appears more than once: which occurrence to replace, counting from 1 at the top of the document. Omit when the anchor is unique.",
          ),
      })
      .refine(
        (value) =>
          value.target === "clipboard" ||
          value.text.length <= REMIX_WRITE_LIMIT,
        {
          message: `document writes cannot exceed ${REMIX_WRITE_LIMIT} characters`,
          path: ["text"],
        },
      )
      .refine(
        (value) => value.target !== "anchored-passage" || !!value.anchor,
        {
          message: "anchor is required for an anchored-passage write",
          path: ["anchor"],
        },
      ),
  },
  undo_last_remix: {
    description:
      "Reverse the last edit YOU made with apply_text, using the app's own undo — which restores formatting a plain-text rewrite cannot. Returns { ok, reason? }. Only your own last edit can be reversed, and only once ('nothing-to-undo' means there is no edit of yours to take back — do not press further, or you start eating the user's own work). Use it when you got something wrong, or when the user asks you to revert.",
    inputSchema: z.object({}),
  },
  insert_image: {
    description:
      "Insert an image into the user's document at the cursor, from a direct image URL. Returns { ok, reason? }. Like apply_text, this is atomic: fetch, place, restore the clipboard. Failure: 'fetch-failed' (the URL did not serve a usable image — try the next image_search result; if none work, give the user the URL in chat instead), 'document-not-in-front'.",
    inputSchema: z.object({
      url: z
        .string()
        .url()
        .max(2_000)
        .describe(
          "A direct image-file URL — use `imageUrl` from image_search results, NOT `sourceUrl` (which is the webpage the image appeared on).",
        ),
    }),
  },
} as const;

export type RemixClientToolName = keyof typeof REMIX_CLIENT_TOOLS;

export const REMIX_CLIENT_TOOL_NAMES = Object.keys(
  REMIX_CLIENT_TOOLS,
) as RemixClientToolName[];

export function isRemixClientTool(name: string): name is RemixClientToolName {
  return name in REMIX_CLIENT_TOOLS;
}
