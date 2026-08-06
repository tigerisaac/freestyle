import { createAppLogger } from "@freestyle-voice/utils";
import {
  REMIX_CLIENT_TOOLS,
  type RemixAgentRequest,
  type RemixSkillPrefs,
} from "@freestyle-voice/validations";
import {
  convertToModelMessages,
  type FlexibleSchema,
  stepCountIs,
  streamText,
  type ToolSet,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod/v3";
import { buildRemixAgentSystem } from "./editor/remix-prompts.js";
import {
  activateWritingSkillById,
  selectWritingSkill,
} from "./editor/remix-skills.js";
import { getLlmProvider } from "./llm/registry.js";
import { capture } from "./posthog.js";
import { createChatModel } from "./providers.js";
import { getThreadMemory, renderThreadMemory } from "./remix-memory.js";

const log = createAppLogger("remix-agent");

/**
 * Composite tools mean fewer, larger steps: the fast path is one read and one
 * atomic write, where the primitive surface cost 6-8 calls before
 * verification. The ceiling stays generous for deliberate long-form work, but
 * a run that has not converged in 16 is lost either way.
 */
export const REMIX_MAX_STEPS = 16;

/**
 * Look before doing anything else.
 *
 * The agent's most common failure has never been a damaged document — it is
 * an untouched one. Asked to write a note, the model composes it, puts it in
 * its chat reply, and stops, having called nothing. The user is left copying
 * their own text out of a chat bubble, which is the one job Remix exists to
 * do for them.
 *
 * Prompt wording does not fix this, and the harness says why: on those runs
 * there are zero tool calls, so every instruction carried on a tool result
 * arrives too late to matter. The model never got as far as looking.
 *
 * So the first step is pinned to `read_writing_context` specifically, rather
 * than to "some tool". Two things go wrong with a generic requirement. The
 * model satisfies it with whatever is nearest, which for a question meant
 * answering by editing the user's sentence — a write nobody asked for. And a
 * bare "call something" is a surprisingly hard instruction to satisfy: one
 * evaluated run returned no tool call and no text at all. Naming the tool
 * removes both failures, and it is the honest first move anyway: the agent
 * should know what is under the cursor before it decides what to do.
 *
 * The cost is one cheap call — the default scope reads the selection without
 * touching the document — and it buys the read result's own guidance, which
 * is what finally separates "write this" from "answer this" at the moment the
 * choice is actually made.
 *
 * Only the first step is constrained; leaving a choice pinned would forbid
 * the model ever finishing.
 */
function requireFirstToolCall({ stepNumber }: { stepNumber: number }) {
  return stepNumber === 0
    ? {
        toolChoice: { type: "tool" as const, toolName: "read_writing_context" },
      }
    : {};
}

/**
 * The skill-activation tool, offered only when routing was not confident.
 *
 * It is a server tool with a real `execute`, unlike the client tools: nothing
 * about it touches the user's machine, so it resolves inside the same call
 * rather than pausing the loop for the renderer. That is what keeps the
 * low-confidence path from costing an extra round trip to the desktop.
 */
interface WritingSkillChip {
  skillId: string;
  label: string;
}

interface RemixMessageMetadata {
  writingSkill?: WritingSkillChip;
}

function activateWritingSkillTool(
  onActivate: (chip: WritingSkillChip) => void,
): ToolSet {
  return {
    activate_writing_skill: tool({
      description:
        "Load a writing skill from the catalog above, when one clearly fits this request. Returns the skill's guidance, which you then follow while writing. Activate at most one; most short edits and formatting tasks need none at all. Optionally name a `resource` from the catalog line to load one focused section instead of the general overview.",
      inputSchema: z.object({
        id: z
          .string()
          .describe("The skill id, exactly as written in the catalog."),
        resource: z
          .string()
          .optional()
          .describe(
            "A resource or section id from the skill's catalog line, when a specific one fits better than the overview.",
          ),
      }),
      execute: async ({ id, resource }) => {
        const activated = activateWritingSkillById(id, resource);
        if (!activated) return { ok: false, reason: `unknown skill: ${id}` };
        onActivate(activated.chip);
        return {
          ok: true,
          guidance: activated.promptBlock,
          writingSkill: activated.chip,
        };
      },
    }),
  };
}

/**
 * The client-side tools, as AI SDK declarations. No `execute`: the loop
 * pauses at the call, the call streams to the renderer, the renderer executes
 * it against the document and re-sends the thread with the result appended.
 */
export function remixClientTools(): ToolSet {
  return Object.fromEntries(
    Object.entries(REMIX_CLIENT_TOOLS).map(([name, def]) => [
      name,
      tool({
        description: def.description,
        // The per-tool schema types are a union across the map; the cast keeps
        // tool()'s generic from collapsing it to never. Validation still runs
        // against each tool's own zod schema at call time.
        inputSchema: def.inputSchema as FlexibleSchema<Record<string, unknown>>,
      }),
    ]),
  );
}

export interface ByokModelChoice {
  provider: string;
  model_id: string;
}

/**
 * The agent loop on the user's own model. Identical shape to the cloud run —
 * same system prompt, same client tools — minus the server tools (web search
 * is a cloud capability) and minus metering.
 */
export async function runRemixAgentLocally(
  request: RemixAgentRequest,
  llm: ByokModelChoice,
  abortSignal: AbortSignal | undefined,
  skills?: RemixSkillPrefs,
  threadId?: number,
): Promise<Response> {
  const providerOptions = getLlmProvider(llm.provider)?.providerOptions?.(
    llm.model_id,
  );
  const started = Date.now();

  const selection = selectWritingSkill({
    instruction: latestUserText(request.messages as UIMessage[]),
    target:
      request.context.target ??
      (request.context.selection ? "selected" : "empty"),
    selectionWords: countWords(request.context.selection),
    appName: request.context.appName,
    activeSkillId: activeSkillInThread(request.messages as UIMessage[]),
    disabledCategories: skills?.disabledCategories,
    enabled: skills?.enabled ?? false,
    preferredSkillId: skills?.preferredSkillId,
  });
  // Only offered when routing was unsure — a pre-activated skill is already
  // in the prompt, and leaving the tool available would invite a second,
  // overlapping editorial pass.
  let activatedByModel: WritingSkillChip | null = null;
  const skillTools =
    selection.promptBlock && !selection.chip
      ? activateWritingSkillTool((chip) => {
          activatedByModel = chip;
        })
      : {};

  // Memory is the user's own material, so it goes in ahead of any craft
  // guidance: what they decided outranks advice about how to write.
  const memory = threadId ? renderThreadMemory(getThreadMemory(threadId)) : "";

  const result = streamText({
    model: await createChatModel(llm.provider, llm.model_id),
    system: buildRemixAgentSystem(
      request.context,
      // This is the BYOK lane: only the client tools are registered here, so
      // the prompt must not advertise the cloud-only search tools.
      { hasWebSearch: false },
      [memory, selection.promptBlock].filter(Boolean).join("\n\n"),
    ),
    messages: await convertToModelMessages(request.messages as UIMessage[]),
    tools: { ...remixClientTools(), ...skillTools },
    stopWhen: stepCountIs(REMIX_MAX_STEPS),
    prepareStep: requireFirstToolCall,
    abortSignal,
    ...(providerOptions ? { providerOptions } : {}),
    onError: ({ error }) => {
      log.error(`Remix agent (BYOK) stream error: ${error}`);
    },
    onFinish: ({ usage }) => {
      capture("remix agent completed", {
        provider: llm.provider,
        model: llm.model_id,
        duration_ms: Date.now() - started,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        // Operational metadata only, per §9 — never document content.
        skill_bundle: selection.telemetry.bundleHash.slice(0, 12),
        skill_id: activatedByModel?.skillId ?? selection.telemetry.skillId,
        skill_routed: selection.telemetry.skillId,
        skill_confidence: selection.telemetry.confidence,
        skill_resources: selection.telemetry.loaded.join(","),
        skill_words: selection.telemetry.words,
        target: request.context.target ?? null,
      });
    },
  });

  const response = result.toUIMessageStreamResponse<
    UIMessage<RemixMessageMetadata>
  >({
    onError: (error) =>
      error instanceof Error ? error.message : String(error),
    // Headers make a pre-routed skill visible immediately; message metadata is
    // the durable record. It also covers model-selected skills, which are not
    // known until after response headers have already been sent.
    messageMetadata: ({ part }) => {
      if (part.type !== "start" && part.type !== "finish") return undefined;
      const writingSkill = activatedByModel ?? selection.chip ?? undefined;
      return writingSkill ? { writingSkill } : undefined;
    },
  });

  // The chip's contents ride a header rather than a stream part: the skill is
  // known before the first token, the pill wants to show it immediately, and
  // a header is the one channel that survives the cloud path's proxying
  // unchanged. Ids and labels only — never anything derived from the document.
  if (selection.chip) {
    response.headers.set("X-Freestyle-Skill", selection.chip.skillId);
    response.headers.set("X-Freestyle-Skill-Label", selection.chip.label);
  }
  return response;
}

/** The most recent user turn — what the router actually scores. */
function latestUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "user") continue;
    const text = (message.parts ?? [])
      .filter(
        (part): part is { type: "text"; text: string } =>
          (part as { type?: string }).type === "text",
      )
      .map((part) => part.text)
      .join(" ")
      .trim();
    if (text) return text;
  }
  return "";
}

/**
 * The skill this thread already settled on, recovered from its own history.
 *
 * The server is stateless — `messages` IS the conversation — so thread
 * stickiness has to be read back out of the transcript rather than held in
 * memory. An earlier activation is the record of that decision.
 */
function activeSkillInThread(messages: UIMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const metadata = messages[i]?.metadata as RemixMessageMetadata | undefined;
    if (metadata?.writingSkill?.skillId) {
      return metadata.writingSkill.skillId;
    }
    for (const part of messages[i]?.parts ?? []) {
      const typed = part as { type?: string; input?: { id?: unknown } };
      if (
        typed.type === "tool-activate_writing_skill" &&
        typeof typed.input?.id === "string"
      ) {
        return typed.input.id;
      }
    }
  }
  return null;
}

function countWords(text: string | null): number | undefined {
  if (!text) return undefined;
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}
