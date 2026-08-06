import { useChat } from "@ai-sdk/react";
import { REMIX_PRESETS, type RemixPreset } from "@freestyle-voice/validations";
import { AgentActivity } from "@renderer/components/agents/agent-activity";
import type { AgentActivityItem } from "@renderer/components/agents/agent-activity/types";
import { AgentDisclosure } from "@renderer/components/agents/agent-disclosure";
import { ThinkingShimmer } from "@renderer/components/agents/loading-states/thinking-shimmer";
import { MessageScroller } from "@renderer/components/agents/message-scroller";
import { capture } from "@renderer/lib/analytics";
import { apiFetch } from "@renderer/lib/api";
import {
  beginRemixTurn,
  createSession,
  type RemixHost,
  runRemixTool,
} from "@renderer/lib/remix-composites";
import {
  DefaultChatTransport,
  type DynamicToolUIPart,
  getToolOrDynamicToolName,
  isTextUIPart,
  isToolOrDynamicToolUIPart,
  lastAssistantMessageIsCompleteWithToolCalls,
  type ToolUIPart,
  type UIMessage,
} from "ai";
import { domMax, LazyMotion } from "motion/react";
import type React from "react";
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ThinkingOrb } from "thinking-orbs";
import {
  type RemixSelectionPayload,
  targetFromSelection,
} from "../../../shared/remix";
import { SETTINGS_KEYS } from "../../../shared/settings-keys";
import { FreestyleMark } from "./freestyle-mark";
import {
  REMIX_CHAT_MAX_HEIGHT,
  REMIX_CHAT_STRIP,
  REMIX_CHAT_SURFACE,
  type RemixChatAnchor,
} from "./remix-chat-surface";

const INK = "rgba(245, 241, 228, 0.92)";
const INK_DIM = "rgba(245, 241, 228, 0.70)";
const INK_FAINT = "rgba(245, 241, 228, 0.52)";
const OLIVE = "#8AB62A";

export {
  REMIX_CHAT_STRIP,
  REMIX_CHAT_SURFACE,
  type RemixChatAnchor,
} from "./remix-chat-surface";

function anchoredLayerStyle(
  anchor: RemixChatAnchor,
  size: { width: number; height: number },
): React.CSSProperties {
  return {
    position: "absolute",
    width: size.width,
    height: size.height,
    ...(anchor.v === "top" ? { top: 0 } : { bottom: 0 }),
    ...(anchor.h === "right"
      ? { right: 0 }
      : { left: "50%", transform: "translateX(-50%)" }),
  };
}

interface ThreadState {
  threadId: number;
  resumed: boolean;
  messages: UIMessage[];
}

export interface RemixChatProps {
  context: RemixSelectionPayload;
  initialInstruction: string | null;
  minimized: boolean;
  onMiniHeightChange?: (height: number) => void;
  /** Natural height of the full card so the surface can size to its thread. */
  onHeightChange?: (height: number) => void;
  anchor: RemixChatAnchor;
  onExpand: () => void;
  /** Lets the owner keep a live or answered run on screen as the pill. */
  onMinimize: (options?: { busy?: boolean; hasContent?: boolean }) => void;
  onClose: () => void;
}

export function RemixChat(props: RemixChatProps): React.JSX.Element {
  const [thread, setThread] = useState<ThreadState | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // State (not props) so "New" can clear it without a remount re-sending.
  const [initialInstruction, setInitialInstruction] = useState(
    props.initialInstruction,
  );

  // Surface sizes to this until natural-height measurement lands with the
  // thinking-orbs polish. Cap keeps the pill from jumping to an empty 560px.
  useEffect(() => {
    props.onHeightChange?.(REMIX_CHAT_MAX_HEIGHT);
  }, [props.onHeightChange]);

  // Pill is focusable:false; follow the card so the composer can take keyboard.
  useEffect(() => {
    window.api?.setRemixChatFocus(!props.minimized);
    return () => window.api?.setRemixChatFocus(false);
  }, [props.minimized]);

  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/remix/thread")
      .then(async (res) => {
        if (!res.ok) throw new Error(`thread fetch ${res.status}`);
        const data = (await res.json()) as ThreadState & {
          threadId: number | null;
        };
        if (data.threadId !== null) {
          if (!cancelled) setThread(data as ThreadState);
          return;
        }
        const created = await apiFetch("/api/remix/thread/new", {
          method: "POST",
        });
        if (!created.ok) throw new Error(`thread new ${created.status}`);
        const fresh = (await created.json()) as ThreadState;
        if (!cancelled) setThread(fresh);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loadFailed || !props.minimized) return;
    const timer = setTimeout(props.onClose, MINI_IDLE_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [loadFailed, props.minimized, props.onClose]);

  useEffect(() => {
    if (props.initialInstruction) {
      setInitialInstruction(props.initialInstruction);
    }
  }, [props.initialInstruction]);

  const startNewThread = useCallback(() => {
    setInitialInstruction(null);
    setThread(null);
    setLoadFailed(false);
    apiFetch("/api/remix/thread/new", { method: "POST" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`thread new ${res.status}`);
        setThread((await res.json()) as ThreadState);
      })
      .catch(() => setLoadFailed(true));
  }, []);

  if (loadFailed) {
    if (props.minimized) {
      return <MiniStrip text="Remix couldn't open" onEnter={props.onExpand} />;
    }
    return (
      <div style={{ padding: 14, fontSize: 12.5, color: INK_DIM }}>
        <style>{REMIX_CHAT_CSS}</style>
        Couldn't open Remix. Is the Freestyle server running?
      </div>
    );
  }
  if (!thread) {
    if (props.minimized) {
      return <MiniStrip text="Opening Remix…" busy onEnter={props.onExpand} />;
    }
    return (
      <div style={{ padding: 14, fontSize: 12.5, color: INK_FAINT }}>
        <style>{REMIX_CHAT_CSS}</style>
        Opening Remix…
      </div>
    );
  }
  return (
    <RemixThread
      key={thread.threadId}
      thread={thread}
      context={props.context}
      initialInstruction={initialInstruction}
      minimized={props.minimized}
      anchor={props.anchor}
      onExpand={props.onExpand}
      onMinimize={props.onMinimize}
      onClose={props.onClose}
      onNewThread={startNewThread}
      onMiniHeightChange={props.onMiniHeightChange}
    />
  );
}

/**
 * The pill's status mark, at the one size both states share.
 *
 * `MINI_MARK` is the box; everything drawn into it is centred and clipped to
 * it, so the running orb and the settled check occupy identical space and the
 * line of text beside them never shifts when a run lands.
 */
const MINI_MARK = 22;

/** The one entrance curve the pill's marks share. */
const REMIX_EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";

/**
 * The running orb, at its native scale.
 *
 * Not the 64 preset scaled down. Supersampling looks right in the backing
 * store and wrong on screen: the compositor resolves a CSS-scaled canvas with
 * bilinear filtering, and a field of sub-pixel dots run through that shimmers
 * — grainier than the coarse preset it was meant to fix. Canvas pixels map
 * 1:1 to device pixels here, which is the only arrangement that cannot alias.
 */
function MiniOrb({ state }: { state: "composing" | "searching" }) {
  return (
    <span className="remix-mini-mark">
      <ThinkingOrb state={state} size={20} theme="dark" />
    </span>
  );
}

/** Arc close, then colour flood. One timeline, so neither leg can strand. */
const SWEEP_ARC_MS = 150;
const SWEEP_FLOOD_MS = 300;
const SWEEP_TOTAL_MS = SWEEP_ARC_MS + SWEEP_FLOOD_MS;
const SWEEP_ARC_END = SWEEP_ARC_MS / SWEEP_TOTAL_MS;

function RestMark({ failed }: { failed: boolean }) {
  const maskId = useId();
  const arcRef = useRef<SVGCircleElement | null>(null);
  const discRef = useRef<SVGRectElement | null>(null);
  const circumference = 2 * Math.PI * 6.1;

  /**
   * The markup is the RESTING state — filled disc, spent arc — and the
   * entrance is one `fill: "none"` timeline played over it.
   *
   * That direction is deliberate. Any fill mode that holds a keyframe leaves
   * the mark showing the *opening* frame wherever the timeline cannot run: an
   * occluded window freezes WAAPI at t=0, and the pill is occluded often. With
   * no fill, a frozen or skipped animation degrades to the correct final look
   * instead of an empty circle. Both legs ride one timeline for the same
   * reason — a delayed second animation would strand the disc mid-sweep.
   */
  useLayoutEffect(() => {
    const arc = arcRef.current;
    const disc = discRef.current;
    if (!arc || !disc) return;
    if (
      typeof window === "undefined" ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ===
        true ||
      // An occluded window does not advance WAAPI, and an animation parked at
      // its first frame would leave the mark drawn as an empty circle. Nobody
      // is watching an entrance they cannot see, so skip straight to settled.
      document.hidden
    ) {
      return;
    }
    disc.style.transformOrigin = "8px 8px";
    const options: KeyframeAnimationOptions = {
      duration: SWEEP_TOTAL_MS,
      fill: "none",
    };
    const running = [
      arc.animate(
        [
          {
            offset: 0,
            opacity: 1,
            strokeDashoffset: `${circumference}`,
            easing: REMIX_EASE_OUT,
          },
          {
            offset: SWEEP_ARC_END,
            opacity: 1,
            strokeDashoffset: "0",
            easing: "ease-out",
          },
          { offset: SWEEP_ARC_END + 0.09, opacity: 0, strokeDashoffset: "0" },
          { offset: 1, opacity: 0, strokeDashoffset: "0" },
        ],
        options,
      ),
      disc.animate(
        [
          {
            offset: 0,
            transform: "scale(0.42)",
            opacity: 0,
            filter: "blur(1.4px)",
            easing: "linear",
          },
          {
            offset: SWEEP_ARC_END,
            transform: "scale(0.42)",
            opacity: 0,
            filter: "blur(1.4px)",
            // Overshoots a few percent and settles back. A straight ease-out
            // landed the colour like a light switch, with nowhere for the
            // impact to go; the blur resolving alongside keeps the arc and the
            // disc reading as one object rather than two swapping places.
            easing: "cubic-bezier(0.34, 1.16, 0.36, 1)",
          },
          {
            offset: 0.75,
            transform: "scale(1.055)",
            opacity: 1,
            filter: "blur(0px)",
          },
          { offset: 1, transform: "scale(1)", opacity: 1, filter: "blur(0px)" },
        ],
        options,
      ),
    ];
    // Without this a re-mount stacks a second copy on the first.
    return () => {
      for (const animation of running) animation.cancel();
    };
  }, [circumference]);

  const color = failed ? "rgba(224, 128, 95, 0.92)" : INK;
  const glyph = failed ? (
    <path
      d="M 5.6 5.6 L 10.4 10.4 M 10.4 5.6 L 5.6 10.4"
      stroke="#000"
      strokeWidth={1.5}
      strokeLinecap="round"
      fill="none"
    />
  ) : (
    <path
      d="M 5.35 8.25 L 7.15 10.05 L 10.75 5.95"
      stroke="#000"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  );

  return (
    <span className="remix-mini-mark">
      <svg
        width={MINI_MARK}
        height={MINI_MARK}
        viewBox="0 0 16 16"
        aria-hidden="true"
      >
        <mask id={maskId}>
          <rect width="16" height="16" fill="#000" />
          <circle cx="8" cy="8" r="6.9" fill="#fff" />
          {glyph}
        </mask>
        <circle
          ref={arcRef}
          cx="8"
          cy="8"
          r="6.1"
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={0}
          opacity={0}
          transform="rotate(-90 8 8)"
        />
        <rect
          ref={discRef}
          width="16"
          height="16"
          fill={color}
          mask={`url(#${maskId})`}
        />
      </svg>
    </span>
  );
}

function MiniStrip(props: {
  text: string;
  busy?: boolean;
  failed?: boolean;
  onEnter?: () => void;
}): React.JSX.Element {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: expand also via hotkey/bar
    <div
      className="remix-chat dark"
      data-testid="remix-chat-mini"
      onMouseEnter={props.onEnter}
    >
      <style>{REMIX_CHAT_CSS}</style>
      <div className="remix-mini" role="status" aria-live="polite">
        {props.busy ? (
          <MiniOrb state="composing" />
        ) : (
          <RestMark failed={props.failed === true} />
        )}
        <span className="remix-mini-line remix-mini-text">{props.text}</span>
      </div>
    </div>
  );
}

interface RemixThreadProps {
  thread: ThreadState;
  context: RemixSelectionPayload;
  initialInstruction: string | null;
  minimized: boolean;
  anchor: RemixChatAnchor;
  onExpand: () => void;
  onMinimize: (options?: { busy?: boolean; hasContent?: boolean }) => void;
  onClose: () => void;
  onNewThread: () => void;
  onMiniHeightChange?: (height: number) => void;
}

interface ActionRow {
  id: number;
  label: string;
  status: "running" | "done" | "failed";
  detail?: string;
}

const MINIMIZE_GRACE_MS = 380;
const MINI_IDLE_DISMISS_MS = 7000;
const MINI_SETTLED_DISMISS_MS = 3000;
/** Vertical padding of the expanded pill. */
const MINI_STRIP_PAD = 24;
/** Main's 340 window cap, minus the chrome. */
const MINI_STRIP_MAX = 316;

function RemixThread(props: RemixThreadProps): React.JSX.Element {
  const { thread, minimized, anchor, onExpand, onMinimize, onClose } = props;
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [actions, setActions] = useState<ActionRow[]>([]);
  const actionSeqRef = useRef(0);

  const contextRef = useRef<RemixSelectionPayload>(props.context);
  const [liveContext, setLiveContext] = useState<RemixSelectionPayload>(
    props.context,
  );
  useEffect(() => {
    contextRef.current = props.context;
    setLiveContext(props.context);
  }, [props.context]);
  const lastInstructionRef = useRef<string>("");

  /**
   * Which writing skills this user allows, travelling with every request.
   *
   * Read once into a ref rather than subscribed to: the value is only ever
   * consulted at send time, and the pill has no React Query cache to share.
   * Absent settings mean the layer stays off, which is the shipped default.
   */
  const skillPrefsRef = useRef<{
    enabled: boolean;
    disabledCategories?: string[];
  }>({ enabled: false });
  useEffect(() => {
    let cancelled = false;
    void apiFetch("/api/settings")
      .then(async (res) => {
        if (!res.ok) return;
        const settings = (await res.json()) as Record<string, string>;
        if (cancelled) return;
        let disabled: string[] | undefined;
        try {
          const raw = settings[SETTINGS_KEYS.remixDisabledSkillCategories];
          const parsed = raw ? (JSON.parse(raw) as unknown) : null;
          if (Array.isArray(parsed)) {
            disabled = parsed.filter(
              (entry): entry is string => typeof entry === "string",
            );
          }
        } catch {
          // A corrupt list means "nothing disabled", never a failed request.
        }
        skillPrefsRef.current = {
          enabled: settings[SETTINGS_KEYS.remixWritingSkills] === "true",
          disabledCategories: disabled,
        };
      })
      .catch(() => {
        // The layer stays off; the agent still runs without it.
      });
    return () => {
      cancelled = true;
    };
  }, []);


  /**
   * What the model's tools actually do, and what it remembers between them.
   *
   * The session outlives a turn — its stale-target history is what lets a
   * second write revise the first rather than land beside it — so it is a ref,
   * reset per user-directed turn by `beginRemixTurn` rather than recreated.
   */
  const sessionRef = useRef(createSession());
  const host = useMemo<RemixHost>(
    () => ({
      // Wrapped so every composite that looks at the document also refreshes
      // the card's own idea of where the user is. The composites read context
      // through this one call, so there is nowhere else to hook it.
      remixGetContext: async () => {
        const res = await window.api.remixGetContext();
        if (res.ok) {
          contextRef.current = {
            text: res.selection,
            target: res.target ?? targetFromSelection(res.selection),
            appName: res.appName,
            windowTitle: res.windowTitle,
            url: res.url,
            clipboard: res.clipboardPreview ?? null,
            clipboardLength: res.clipboardLength ?? 0,
            capturedAt: Date.now(),
          };
          setLiveContext(contextRef.current);
        }
        return res;
      },
      remixReadDocument: () => window.api.remixReadDocument(),
      remixReadSurroundings: () => window.api.remixReadSurroundings(),
      remixSelectAll: () => window.api.remixSelectAll(),
      remixSelectText: (text, occurrence) =>
        window.api.remixSelectText(text, occurrence),
      remixCollapseSelection: () => window.api.remixCollapseSelection(),
      remixCopy: () => window.api.remixCopy(),
      remixGetClipboard: () => window.api.remixGetClipboard(),
      remixSetClipboard: (text) => window.api.remixSetClipboard(text),
      remixSetClipboardImage: (url) => window.api.remixSetClipboardImage(url),
      remixPasteClipboard: () => window.api.remixPasteClipboard(),
      remixPasteText: (text) => window.api.remixPasteText(text),
      remixPasteImage: (url) => window.api.remixPasteImage(url),
      remixUndo: () => window.api.remixUndo(),
    }),
    [],
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: "/api/remix/agent",

        fetch: (async (_input: unknown, init?: RequestInit) => {
          const res = await apiFetch("/api/remix/agent", init ?? {});
          if (res.status === 401) {
            void window.api?.cloudPromptSignIn();
            throw new Error("Sign in to Freestyle Cloud to use Remix.");
          }
          if (res.status === 429) {
            void window.api?.cloudPromptUpgrade();
            throw new Error("You've hit this week's free limit.");
          }
          if (!res.ok) {
            const body = (await res.json().catch(() => null)) as {
              detail?: string;
            } | null;
            throw new Error(body?.detail || `Remix failed (${res.status}).`);
          }
          return res;
        }) as typeof fetch,
        prepareSendMessagesRequest: ({ messages }) => ({
          body: {
            messages,
            context: {
              selection: contextRef.current.text,
              // Only the status travels — the text itself is `selection` —
              // and it is what tells the agent that an empty target is a
              // destination rather than a failure.
              target: contextRef.current.target?.status,
              appName: contextRef.current.appName,
              windowTitle: contextRef.current.windowTitle,
              clipboard: contextRef.current.clipboard ?? null,
              clipboardLength: contextRef.current.clipboardLength ?? 0,
              capturedAt: contextRef.current.capturedAt,
            },
            skills: skillPrefsRef.current,
          },
        }),
      }),
    [],
  );

  /**
   * Run one model-visible tool.
   *
   * The sequencing that used to live here — select, copy, collapse, paste, in
   * the right order and never leaving a document fully selected — now lives in
   * `remix-composites`, which is code that runs the same way every time and
   * can refuse rather than guess. This is only the bridge to it.
   */
  const executeTool = useCallback(
    async (toolCall: {
      toolName: string;
      toolCallId: string;
      input: unknown;
    }): Promise<Record<string, unknown>> => {
      const name = toolCall.toolName;
      const input = (toolCall.input ?? {}) as Record<string, unknown>;
      const result = await runRemixTool(
        host,
        sessionRef.current,
        name,
        input,
        thread.threadId,
      );
      if (import.meta.env.DEV) {
        console.log(
          `[remix] ${name}(${JSON.stringify(toolCall.input)?.slice(0, 400) ?? ""}) →`,
          JSON.stringify(result).slice(0, 400),
        );
      }
      return result;
    },
    [host, thread.threadId],
  );
  const { messages, sendMessage, addToolResult, status, stop, clearError } =
    useChat<UIMessage>({
      id: `remix-thread-${thread.threadId}`,
      messages: thread.messages,
      transport,
      // Long feedback streams otherwise re-parse markdown on every token and
      // stutter the pill; ~50ms keeps the text feeling live without thrashing.
      experimental_throttle: 50,
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
      onToolCall: async ({ toolCall }) => {
        const output = await executeTool(
          toolCall as unknown as {
            toolName: string;
            toolCallId: string;
            input: unknown;
          },
        );
        void addToolResult({
          tool: getToolOrDynamicToolName(toolCall as never) as never,
          toolCallId: (toolCall as { toolCallId: string }).toolCallId,
          output,
        });
      },
      onError: (err) => {
        setNotice(err.message || "Remix failed.");
      },
      onFinish: ({ messages: finished }) => {
        void apiFetch("/api/remix/thread/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadId: thread.threadId,
            messages: finished,
          }),
        }).catch(() => {});
      },
    });

  const busy = status === "submitted" || status === "streaming";
  const busyRef = useRef(busy);
  busyRef.current = busy;
  // Anything the user would want to read after walking away. Same ref
  // treatment as `busy`, and for the same reason.
  const hasContentRef = useRef(false);
  hasContentRef.current = messages.length > 0;

  const narrating = useMemo(
    () =>
      messages.some(
        (message) =>
          message.role === "assistant" &&
          message.parts.some(
            (part) =>
              isToolOrDynamicToolUIPart(part) &&
              part.state !== "output-available" &&
              part.state !== "output-error",
          ),
      ),
    [messages],
  );

  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (busy) {
      setSettled(false);
      return;
    }
    const timer = setTimeout(() => setSettled(true), 450);
    return () => clearTimeout(timer);
  }, [busy]);

  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(
    () => () => {
      void stopRef.current();
    },
    [],
  );

  // Guard so the opening instruction is sent exactly once.
  const sentInitialRef = useRef(false);
  useEffect(() => {
    if (sentInitialRef.current) return;
    const instruction = props.initialInstruction?.trim();
    if (!instruction) return;
    sentInitialRef.current = true;
    lastInstructionRef.current = instruction;
    void sendMessage({ text: instruction });
    capture("remix_message_sent", { source: "dictated" });
  }, [props.initialInstruction, sendMessage]);

  // Seed from restored thread so reloaded history never recounts tools.
  const seenToolCallsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    let seen = seenToolCallsRef.current;
    if (!seen) {
      seen = new Set<string>();
      for (const message of thread.messages) {
        for (const part of message.parts) {
          if (isToolOrDynamicToolUIPart(part)) seen.add(part.toolCallId);
        }
      }
      seenToolCallsRef.current = seen;
    }
    for (const message of messages) {
      if (message.role !== "assistant") continue;
      for (const part of message.parts) {
        if (!isToolOrDynamicToolUIPart(part)) continue;
        if (seen.has(part.toolCallId)) continue;
        seen.add(part.toolCallId);
        capture("remix_tool_used", { tool: getToolOrDynamicToolName(part) });
      }
    }
  }, [messages, thread.messages]);

  // Document-level mouseout: element leave is lost when rows reflow under the
  // cursor. Grace timer distinguishes leave from edge graze; a draft pins open.
  const minimizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearMinimizeTimer = useCallback(() => {
    if (minimizeTimerRef.current) {
      clearTimeout(minimizeTimerRef.current);
      minimizeTimerRef.current = null;
    }
  }, []);
  useEffect(() => clearMinimizeTimer, [clearMinimizeTimer]);
  const handleMouseEnter = useCallback(() => {
    clearMinimizeTimer();
    if (minimized) onExpand();
  }, [clearMinimizeTimer, minimized, onExpand]);
  useEffect(() => {
    if (minimized) return;
    const handleOver = (): void => {
      clearMinimizeTimer();
      document.removeEventListener("mouseover", handleOver);
    };
    const handleOut = (event: MouseEvent): void => {
      if (event.relatedTarget) return;
      if (inputRef.current?.value.trim()) return;
      clearMinimizeTimer();
      minimizeTimerRef.current = setTimeout(() => {
        minimizeTimerRef.current = null;
        document.removeEventListener("mouseover", handleOver);
        // Read through the ref, not the closure: a run that starts during the
        // grace window has to count, and putting `busy` in this effect's deps
        // would tear the listeners down and rebuild them on every token.
        onMinimize({
          busy: busyRef.current,
          hasContent: hasContentRef.current,
        });
      }, MINIMIZE_GRACE_MS);
      document.addEventListener("mouseover", handleOver);
    };
    document.addEventListener("mouseout", handleOut);
    return () => {
      document.removeEventListener("mouseout", handleOut);
      document.removeEventListener("mouseover", handleOver);
    };
  }, [minimized, onMinimize, clearMinimizeTimer]);

  useEffect(() => {
    if (minimized) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      stopRef.current();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [minimized, onClose]);

  const finalText = useMemo(() => {
    if (busy) return null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message.role !== "assistant") continue;
      const text = message.parts
        .filter(isTextUIPart)
        .map((part) => part.text)
        .join("")
        .trim();
      return text || null;
    }
    return null;
  }, [messages, busy]);
  /**
   * The pill opens into the minimized card once — when a run lands.
   *
   * A pill is the resting shape: leaving the big card collapses to one line,
   * and one line is all a run in flight ever shows. Completion is the single
   * moment worth more room, because the answer has just arrived and the user
   * is not in front of it. Everything else stays at strip height, so this
   * reads as the pill opening rather than as a second card that never left.
   */
  const showFullFinal =
    minimized && settled && notice === null && finalText !== null;
  const miniMessageRef = useRef<HTMLDivElement | null>(null);
  const [miniContentHeight, setMiniContentHeight] = useState<number | null>(
    null,
  );
  const miniStripHeight = showFullFinal
    ? Math.min(
        Math.max(
          miniContentHeight ?? REMIX_CHAT_STRIP.height,
          REMIX_CHAT_STRIP.height,
        ),
        MINI_STRIP_MAX,
      )
    : REMIX_CHAT_STRIP.height;

  // biome-ignore lint/correctness/useExhaustiveDependencies: finalText re-measures when a new answer lands in the same settled state
  useLayoutEffect(() => {
    if (!showFullFinal) {
      setMiniContentHeight(null);
      return;
    }
    const el = miniMessageRef.current;
    if (!el) return;
    setMiniContentHeight(el.scrollHeight + MINI_STRIP_PAD);
  }, [showFullFinal, finalText]);

  const onMiniHeightChangeRef = useRef(props.onMiniHeightChange);
  onMiniHeightChangeRef.current = props.onMiniHeightChange;
  useEffect(() => {
    onMiniHeightChangeRef.current?.(miniStripHeight);
  }, [miniStripHeight]);

  useEffect(() => {
    if (!minimized || !settled) return;
    const timer = setTimeout(onClose, MINI_SETTLED_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [minimized, settled, onClose]);

  const refreshContext = useCallback(async () => {
    try {
      const re = await window.api.remixRecapture();
      if (re && !re.stale) {
        contextRef.current = {
          // Null can mean empty highlight or a slow reply — keep last known.
          text: re.selection ?? contextRef.current.text,
          target: re.target ?? contextRef.current.target,
          appName: re.appName,
          windowTitle: re.windowTitle,
          url: re.url ?? null,
          clipboard: re.clipboard ?? contextRef.current.clipboard ?? null,
          clipboardLength:
            re.clipboardLength ?? contextRef.current.clipboardLength ?? 0,
          capturedAt: re.capturedAt,
        };
        setLiveContext(contextRef.current);
      }
    } catch {
      // Keep last context.
    }
  }, []);

  const sendText = useCallback(
    (text: string) => {
      setNotice(null);
      clearError();
      lastInstructionRef.current = text;
      // A new instruction is a new turn: the write budget and the revision
      // anchor start over, while the stale-target history carries forward.
      beginRemixTurn(sessionRef.current);
      void sendMessage({ text });
    },
    [clearError, sendMessage],
  );

  const submit = useCallback(() => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    const el = inputRef.current;
    if (el) el.style.height = "auto";
    void sendText(text);
    capture("remix_message_sent", { source: "typed" });
  }, [busy, input, sendText]);

  const presetRunningRef = useRef(false);
  const runPresetTransform = useCallback(async (preset: RemixPreset) => {
    const selection = contextRef.current.text;
    if (!selection) return;
    capture("remix_message_sent", { source: "preset", preset: preset.id });
    const id = ++actionSeqRef.current;
    setActions((rows) => [
      ...rows,
      { id, label: preset.label, status: "running" },
    ]);
    const settle = (patch: Partial<ActionRow>): void =>
      setActions((rows) =>
        rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
      );
    try {
      const res = await apiFetch("/api/remix/transform", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: selection,
          remixId: preset.id,
          appName: contextRef.current.appName,
        }),
      });
      if (res.status === 401) {
        void window.api?.cloudPromptSignIn();
        throw new Error("Sign in to Freestyle Cloud first.");
      }
      if (res.status === 429) {
        void window.api?.cloudPromptUpgrade();
        throw new Error("You've hit this week's free limit.");
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          detail?: string;
        } | null;
        throw new Error(body?.detail || `Remix failed (${res.status}).`);
      }
      const data = (await res.json()) as { text?: string };
      const edited = (data.text ?? "").trim();
      if (!edited) throw new Error("The model returned nothing.");
      const delivered = await window.api.remixPasteText(edited);
      if (!delivered.ok) {
        throw new Error("Couldn't replace it — nothing was changed.");
      }

      contextRef.current = { ...contextRef.current, text: edited };
      settle({ status: "done" });
    } catch (err) {
      settle({
        status: "failed",
        detail: err instanceof Error ? err.message : "Something went wrong.",
      });
    }
  }, []);

  const runPreset = useCallback(
    async (preset: RemixPreset) => {
      if (busy || presetRunningRef.current) return;
      presetRunningRef.current = true;
      try {
        await refreshContext();
        const selection = contextRef.current.text;
        if (!selection) {
          setNotice("Nothing is highlighted — select some text first.");
          return;
        }
        await runPresetTransform(preset);
      } finally {
        presetRunningRef.current = false;
      }
    },
    [busy, refreshContext, runPresetTransform],
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover cancels minimize; Esc closes
    <div
      className="remix-chat dark"
      data-minimized={minimized}
      data-testid={minimized ? "remix-chat-mini" : "remix-chat"}
      onMouseEnter={handleMouseEnter}
    >
      <style>{REMIX_CHAT_CSS}</style>
      {/* domMax for layout projection; strict requires m.* not motion.* */}
      <LazyMotion features={domMax} strict>
        <div
          className="remix-chat-face remix-chat-face-strip"
          style={anchoredLayerStyle(anchor, {
            width: REMIX_CHAT_STRIP.width,
            height: miniStripHeight,
          })}
          aria-hidden={!minimized}
        >
          <div className="remix-mini" data-full={showFullFinal}>
            {/* The orb only earns its canvas while something is actually
                running; a settled pill is a line of text with a mark next to
                it, and a resting orb would animate for no reason. */}
            {busy || !settled ? (
              <MiniOrb state={narrating ? "searching" : "composing"} />
            ) : (
              <RestMark failed={notice !== null} />
            )}
            {showFullFinal ? (
              <div className="remix-mini-message" ref={miniMessageRef}>
                <Markdown text={finalText ?? ""} />
              </div>
            ) : busy || !settled ? (
              <ThinkingShimmer className="remix-mini-line">
                {notice ?? latestActivity(messages, true)}
              </ThinkingShimmer>
            ) : (
              <span className="remix-mini-line remix-mini-text">
                {notice ?? finalText ?? latestActivity(messages, false)}
              </span>
            )}
          </div>
        </div>

        <div
          className="remix-chat-face remix-chat-face-full"
          style={anchoredLayerStyle(anchor, REMIX_CHAT_SURFACE)}
          aria-hidden={minimized}
        >
          <div className="remix-chat-head">
            <span className="remix-chat-title">
              <FreestyleMark size={15} />
              <span className="remix-chat-wordmark">Remix</span>
            </span>
            <span className="remix-chat-actions">
              <button
                type="button"
                className="remix-chat-icon"
                onClick={() => {
                  stop();
                  props.onNewThread();
                }}
                aria-label="Start a new thread"
                title="Start a new thread"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 14 14"
                  aria-hidden="true"
                >
                  <path
                    d="M7 2.5v9M2.5 7h9"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
              <button
                type="button"
                className="remix-chat-icon"
                onClick={() => {
                  stop();
                  onClose();
                }}
                aria-label="Close"
                title="Close (Esc)"
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 10 10"
                  aria-hidden="true"
                >
                  <path
                    d="M2 2l6 6M8 2l-6 6"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </span>
          </div>

          <MessageScroller
            className="remix-chat-scroll"
            viewportRef={scrollRef}
            busy={busy}
            smooth={!busy}
            label="Remix conversation"
            contentClassName="remix-chat-thread"
          >
            {!minimized &&
              messages.length === 0 &&
              actions.length === 0 &&
              !busy && (
                <div className="remix-chat-empty">
                  {liveContext.text
                    ? "Say or type what to do with your selection."
                    : "Nothing selected — ask me to write, research, or answer."}
                </div>
              )}
            {!minimized &&
              actions.map((action) => (
                <div
                  key={action.id}
                  className="remix-chat-action"
                  data-failed={action.status === "failed"}
                >
                  {action.status === "running"
                    ? `${action.label}…`
                    : action.status === "done"
                      ? `${action.label} — replaced your text`
                      : `${action.label} failed — ${action.detail ?? ""}`}
                </div>
              ))}
            {!minimized &&
              messages.map((message, index) => (
                <MessageRow
                  key={message.id}
                  message={message}
                  busy={busy}
                  streaming={
                    busy &&
                    index === messages.length - 1 &&
                    message.role === "assistant"
                  }
                />
              ))}
            {!minimized && busy && !narrating && (
              <ThinkingShimmer className="remix-chat-busy">
                Thinking…
              </ThinkingShimmer>
            )}
          </MessageScroller>

          {notice && (
            <div className="remix-chat-notice" role="alert">
              {notice}
            </div>
          )}

          {!busy && messages.length === 0 && liveContext.text ? (
            <div className="remix-chat-quick">
              {REMIX_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="remix-chat-chip"
                  onClick={() => void runPreset(preset)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          ) : null}

          <div className="remix-chat-composer">
            <textarea
              ref={inputRef}
              className="remix-chat-input"
              rows={1}
              value={input}
              aria-label="Message Remix"
              placeholder={busy ? "Working…" : "Message Remix…"}
              onChange={(e) => {
                setInput(e.target.value);
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            {busy ? (
              <button
                type="button"
                className="remix-chat-send"
                onClick={() => stop()}
                aria-label="Stop"
                title="Stop"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  aria-hidden="true"
                >
                  <rect x="1.5" y="1.5" width="9" height="9" rx="2" />
                </svg>
              </button>
            ) : (
              <button
                type="button"
                className="remix-chat-send"
                disabled={!input.trim()}
                onClick={submit}
                aria-label="Send"
                title="Send"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  aria-hidden="true"
                >
                  <path
                    d="M8 12.8V3.6M4.1 7.4 8 3.5l3.9 3.9"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>
      </LazyMotion>
    </div>
  );
}

const TOOL_LABELS: Record<string, { doing: string; done: string }> = {
  get_context: {
    doing: "Looking at your screen…",
    done: "Checked your screen",
  },
  read_writing_context: {
    doing: "Reading your writing…",
    done: "Read your writing",
  },
  read_document: {
    doing: "Reading the document…",
    done: "Read the document",
  },
  select_all: { doing: "Selecting everything…", done: "Selected everything" },
  select_text: {
    doing: "Selecting in your document…",
    done: "Moved your selection",
  },
  collapse_selection: {
    doing: "Placing the cursor…",
    done: "Placed the cursor",
  },
  copy: { doing: "Reading your selection…", done: "Read your selection" },
  set_clipboard: {
    doing: "Preparing text…",
    done: "Put text on your clipboard",
  },
  set_clipboard_image: {
    doing: "Fetching an image…",
    done: "Put an image on your clipboard",
  },
  paste: { doing: "Pasting…", done: "Pasted into your document" },
  undo: { doing: "Undoing…", done: "Undid the last edit" },
  redo: { doing: "Redoing…", done: "Redid the edit" },
  press_key: { doing: "Pressing a key…", done: "Pressed a key" },
  get_clipboard: {
    doing: "Reading your clipboard…",
    done: "Read your clipboard",
  },
  web_search: { doing: "Searching the web…", done: "Searched the web" },
  image_search: { doing: "Searching images…", done: "Searched images" },
};

function latestActivity(messages: UIMessage[], busy: boolean): string {
  for (let m = messages.length - 1; m >= 0; m--) {
    const message = messages[m];
    for (let i = message.parts.length - 1; i >= 0; i--) {
      const part = message.parts[i];
      if (isToolOrDynamicToolUIPart(part)) {
        const name = getToolOrDynamicToolName(part);
        const labels = TOOL_LABELS[name] ?? {
          doing: `Running ${name}…`,
          done: `Ran ${name}`,
        };
        const finished =
          part.state === "output-available" || part.state === "output-error";
        return finished && !busy ? labels.done : labels.doing;
      }
      if (isTextUIPart(part) && part.text.trim()) {
        // While streaming, the first line grows every chunk — that thrashing
        // the pill is worse than a stable status. Tools still win above.
        if (busy && message.role === "assistant") return "Writing…";
        const line = part.text.trim().split("\n")[0] ?? "";
        if (message.role === "user") return busy ? "Thinking…" : `“${line}”`;
        return line;
      }
    }
  }
  return busy ? "Thinking…" : "Freestyle Remix";
}

const MessageRow = memo(function MessageRow({
  message,
  busy,
  streaming = false,
}: {
  message: UIMessage;
  busy: boolean;
  /** Growing assistant text — render plain until the stream settles. */
  streaming?: boolean;
}): React.JSX.Element {
  if (message.role === "user") {
    const text = message.parts
      .filter(isTextUIPart)
      .map((part) => part.text)
      .join("");
    return <div className="remix-chat-user">{text}</div>;
  }

  const blocks: Array<
    | { kind: "tools"; parts: Array<ToolUIPart | DynamicToolUIPart> }
    | { kind: "text"; text: string; index: number }
  > = [];
  message.parts.forEach((part, index) => {
    if (isToolOrDynamicToolUIPart(part)) {
      const last = blocks[blocks.length - 1];
      if (last?.kind === "tools") last.parts.push(part);
      else blocks.push({ kind: "tools", parts: [part] });
    } else if (isTextUIPart(part) && part.text.trim()) {
      blocks.push({ kind: "text", text: part.text, index });
    }
  });

  return (
    <div className="remix-chat-assistant">
      {blocks.map((block) =>
        block.kind === "tools" ? (
          <ToolActivity
            key={block.parts[0].toolCallId}
            parts={block.parts}
            busy={busy}
          />
        ) : (
          <AssistantText
            key={`text-${block.index}`}
            text={block.text}
            streaming={streaming}
          />
        ),
      )}
    </div>
  );
});

function AssistantText({
  text,
  streaming = false,
}: {
  text: string;
  streaming?: boolean;
}): React.JSX.Element {
  return (
    <div className="remix-chat-response">
      {streaming ? (
        <div className="remix-md remix-md-plain">{text}</div>
      ) : (
        <Markdown text={text} />
      )}
    </div>
  );
}

function pretty(value: unknown): string {
  if (value === undefined || value === null) return "—";
  try {
    const text =
      typeof value === "string" ? value : JSON.stringify(value, null, 2);
    return text.length > 2400 ? `${text.slice(0, 2400)}…` : text;
  } catch {
    return String(value);
  }
}

function ToolStepLabel({
  part,
  label,
}: {
  part: ToolUIPart | DynamicToolUIPart;
  label: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const finished =
    part.state === "output-available" || part.state === "output-error";
  return (
    <span className="remix-chat-step">
      <button
        type="button"
        className="remix-chat-step-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="remix-chat-step-label">{label}</span>
        <svg
          className="remix-chat-step-chevron"
          data-open={open}
          width="8"
          height="8"
          viewBox="0 0 8 8"
          aria-hidden="true"
        >
          <path
            d="M2.5 1.5 5.5 4 2.5 6.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <AgentDisclosure open={open}>
        {/* Spans: AgentActivity puts labels in a <span>; block tags would be invalid. */}
        <span className="remix-chat-step-body">
          <span className="remix-chat-step-key">Input</span>
          <span className="remix-chat-step-pre">{pretty(part.input)}</span>
          {finished && (
            <>
              <span className="remix-chat-step-key">Output</span>
              <span className="remix-chat-step-pre">
                {pretty(
                  part.state === "output-error" ? part.errorText : part.output,
                )}
              </span>
            </>
          )}
        </span>
      </AgentDisclosure>
    </span>
  );
}

function ToolActivity({
  parts,
  busy,
}: {
  parts: Array<ToolUIPart | DynamicToolUIPart>;
  busy: boolean;
}): React.JSX.Element {
  const items: AgentActivityItem[] = parts.map((part) => {
    const name = getToolOrDynamicToolName(part);
    const labels = TOOL_LABELS[name] ?? {
      doing: `Running ${name}…`,
      done: `Ran ${name}`,
    };
    const finished =
      part.state === "output-available" || part.state === "output-error";
    const output =
      part.state === "output-available" &&
      typeof part.output === "object" &&
      part.output !== null
        ? (part.output as { ok?: boolean })
        : null;
    const failed = part.state === "output-error" || output?.ok === false;
    return {
      id: part.toolCallId,
      type: "step",
      label: (
        <ToolStepLabel
          part={part}
          label={failed ? `${labels.done} — didn't work` : labels.done}
        />
      ),
      status: finished ? "complete" : "active",
      meta: finished ? undefined : "…",
    };
  });

  const inFlight = parts.find(
    (part) =>
      part.state !== "output-available" && part.state !== "output-error",
  );

  // Override step summary ("Thought for Ns") — these are document tools.
  const summary = `Ran ${parts.length} ${parts.length === 1 ? "tool" : "tools"}`;
  const activeLabel = inFlight
    ? (TOOL_LABELS[getToolOrDynamicToolName(inFlight)]?.doing ??
      `Running ${getToolOrDynamicToolName(inFlight)}…`)
    : undefined;

  return (
    <AgentActivity
      className="remix-chat-activity"
      items={items}
      contentType="step"
      maxHeight={280}
      summary={summary}
      activeLabel={activeLabel}
      status={inFlight && busy ? "working" : "complete"}
    />
  );
}

const MARKDOWN_COMPONENTS = {
  a: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
};

const Markdown = memo(function Markdown({
  text,
}: {
  text: string;
}): React.JSX.Element {
  return (
    <div className="remix-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={MARKDOWN_COMPONENTS}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

const REMIX_CHAT_CSS = `
  .remix-chat {
    position: relative;
    width: 100%;
    height: 100%;
    font-size: 12.5px;
    color: ${INK};
  }

  .remix-chat-face-strip {
    opacity: 0;
    pointer-events: none;
    visibility: hidden;
    transition: opacity 110ms ease, visibility 0s 110ms;
  }
  .remix-chat[data-minimized="true"] .remix-chat-face-strip {
    opacity: 1;
    pointer-events: auto;
    visibility: visible;
    transition: opacity 200ms ease 60ms, visibility 0s;
  }
  .remix-chat-face-full {
    display: flex;
    flex-direction: column;
    min-height: 0;
    opacity: 1;
    visibility: visible;
    transition: opacity 220ms ease 60ms, visibility 0s;
  }
  .remix-chat[data-minimized="true"] .remix-chat-face-full {
    opacity: 0;
    pointer-events: none;
    visibility: hidden;
    transition: opacity 110ms ease, visibility 0s 110ms;
  }

  /* Padding is measured to the mark's box, not to the ink inside it. The
     22px mark is mostly air at its edges, so a 13px inset — right for the 7px
     dot this replaced — put the orb almost against the rim. 11px left against
     16px right reads as even, because the mark's own margin makes up the
     difference. */
  .remix-mini {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 100%;
    padding: 0 16px 0 11px;
  }
  /* Opened by a landed answer. Top-aligned, because a paragraph beside a
     centred mark reads as misaligned the moment it wraps to a second line. */
  .remix-mini[data-full="true"] {
    align-items: flex-start;
    height: 100%;
    padding: 11px 16px 12px 11px;
  }
  .remix-mini[data-full="true"] .remix-mini-mark { margin-top: -1px; }
  .remix-mini-message {
    flex: 1;
    min-width: 0;
    max-height: ${MINI_STRIP_MAX - MINI_STRIP_PAD}px;
    overflow-y: auto;
    font-size: 12.5px;
    line-height: 1.5;
    color: ${INK_DIM};
  }

  /* One box for both states, so the text does not shift when a run lands. */
  .remix-mini-mark {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    overflow: hidden;
  }

  .remix-mini-line {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .remix-mini-text { color: ${INK_DIM}; }

  /* No -webkit-app-region:drag — it would swallow leave events for minimize. */
  .remix-chat-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 14px 16px 11px;
  }
  .remix-chat-title {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
  }
  .remix-chat-title svg { flex-shrink: 0; color: ${OLIVE}; }
  .remix-chat-wordmark {
    font-family: "Instrument Serif", Georgia, serif;
    font-size: 20px;
    line-height: 1;
    color: ${INK};
  }
  .remix-chat-actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
  .remix-chat-icon {
    width: 26px;
    height: 26px;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 7px;
    background: none;
    color: ${INK_FAINT};
    cursor: pointer;
    transition: background 140ms ease, color 140ms ease;
  }
  .remix-chat-icon:hover { background: rgba(245, 241, 228, 0.08); color: ${INK}; }

  .remix-chat-scroll { flex: 1; min-height: 0; }
  .remix-chat-thread {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 4px 18px 12px;
  }
  .remix-chat-empty {
    color: ${INK_FAINT};
    line-height: 1.5;
    font-size: 13px;
  }
  .remix-chat ::-webkit-scrollbar { width: 9px; height: 9px; }
  .remix-chat ::-webkit-scrollbar-track { background: transparent; }
  .remix-chat ::-webkit-scrollbar-corner { background: transparent; }
  .remix-chat ::-webkit-scrollbar-thumb {
    background: rgba(245, 241, 228, 0.16);
    border-radius: 99px;
    border: 3px solid transparent;
    background-clip: padding-box;
  }
  .remix-chat ::-webkit-scrollbar-thumb:hover {
    background: rgba(245, 241, 228, 0.28);
    border: 3px solid transparent;
    background-clip: padding-box;
  }
  .remix-chat-user {
    align-self: flex-end;
    max-width: 88%;
    background: rgba(245, 241, 228, 0.13);
    border-radius: 13px 13px 4px 13px;
    padding: 8px 12px;
    line-height: 1.5;
    color: ${INK};
    white-space: pre-wrap;
    word-break: break-word;
  }
  .remix-chat-assistant {
    align-self: stretch;
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }
  .remix-chat-activity { font-size: 11.5px; }
  .remix-chat-response { font-size: 13px; }

  .remix-chat-step { display: block; min-width: 0; }
  .remix-chat-step-head {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    border: none;
    background: none;
    padding: 0;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .remix-chat-step-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .remix-chat-step-chevron {
    flex-shrink: 0;
    opacity: 0.5;
    transition: transform 140ms ease, opacity 140ms ease;
  }
  .remix-chat-step-head:hover .remix-chat-step-chevron { opacity: 1; }
  .remix-chat-step-chevron[data-open="true"] { transform: rotate(90deg); opacity: 1; }
  .remix-chat-step-body { display: block; padding: 5px 0 3px; }
  .remix-chat-step-key {
    display: block;
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: ${INK_FAINT};
    padding: 3px 0 2px;
  }
  .remix-chat-step-pre {
    display: block;
    margin: 0;
    padding: 6px 8px;
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.28);
    border: 1px solid rgba(245, 241, 228, 0.08);
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 10px;
    line-height: 1.45;
    color: ${INK_DIM};
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 140px;
    overflow-y: auto;
  }

  .remix-chat-action {
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 9.5px;
    letter-spacing: 0.11em;
    text-transform: uppercase;
    color: ${INK_FAINT};
  }
  .remix-chat-action[data-failed="true"] { color: rgba(224, 128, 95, 0.9); }
  .remix-chat-notice {
    font-size: 11px;
    color: rgba(224, 128, 95, 0.95);
    padding: 6px 18px 0;
    line-height: 1.35;
  }

  .remix-chat-busy { font-size: 12px; }

  .remix-chat-chip {
    display: inline-flex;
    align-items: center;
    border: 1px solid rgba(245, 241, 228, 0.13);
    background: rgba(245, 241, 228, 0.07);
    color: ${INK};
    font-size: 11px;
    line-height: 1;
    padding: 5px 10px;
    border-radius: 999px;
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }
  .remix-chat-chip:hover { background: rgba(245, 241, 228, 0.15); }
  .remix-chat-quick {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    padding: 4px 18px 0;
  }
  .remix-chat-composer {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    margin: 10px 14px 13px;
    padding: 8px 8px 8px 13px;
    border: 1px solid rgba(245, 241, 228, 0.16);
    background: rgba(245, 241, 228, 0.05);
    border-radius: 14px;
    transition: border-color 140ms ease;
  }
  .remix-chat-composer:focus-within { border-color: rgba(245, 241, 228, 0.34); }
  .remix-chat-input {
    flex: 1;
    resize: none;
    border: none;
    background: transparent;
    color: ${INK};
    font-size: 12.5px;
    line-height: 1.45;
    font-family: inherit;
    outline: none;
    padding: 5px 0;
    min-height: 20px;
    max-height: 120px;
  }
  .remix-chat-input::placeholder { color: ${INK_FAINT}; }
  .remix-chat-send {
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 999px;
    background: rgba(245, 241, 228, 0.92);
    color: rgba(24, 22, 18, 0.95);
    cursor: pointer;
    transition: opacity 140ms ease, transform 140ms ease;
  }
  .remix-chat-send svg rect { fill: currentColor; }
  .remix-chat-send:disabled { opacity: 0.3; cursor: default; }
  .remix-chat-send:not(:disabled):hover { transform: scale(1.06); }
  .remix-chat-send:not(:disabled):active { transform: scale(0.95); }

  .remix-md { line-height: 1.6; word-break: break-word; }
  .remix-md-plain { white-space: pre-wrap; }
  .remix-md > *:first-child { margin-top: 0; }
  .remix-md > *:last-child { margin-bottom: 0; }
  .remix-md p { margin: 0 0 8px; }
  .remix-md h1, .remix-md h2, .remix-md h3, .remix-md h4 {
    margin: 12px 0 6px;
    font-weight: 600;
    line-height: 1.3;
    color: ${INK};
  }
  .remix-md h1 { font-size: 14.5px; }
  .remix-md h2 { font-size: 13.5px; }
  .remix-md h3, .remix-md h4 { font-size: 12.5px; }
  .remix-md ul, .remix-md ol { margin: 0 0 8px; padding-left: 18px; }
  .remix-md li { margin: 2px 0; }
  .remix-md li > ul, .remix-md li > ol { margin-bottom: 0; }
  .remix-md a { color: ${OLIVE}; text-decoration: underline; text-underline-offset: 2px; }
  .remix-md a:hover { color: #A6D03F; }
  .remix-md strong { font-weight: 600; color: ${INK}; }
  .remix-md em { font-style: italic; }
  .remix-md code {
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 11px;
    background: rgba(245, 241, 228, 0.1);
    border-radius: 4px;
    padding: 1px 4px;
  }
  .remix-md pre {
    margin: 0 0 8px;
    padding: 8px 10px;
    border-radius: 10px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(245, 241, 228, 0.08);
    overflow-x: auto;
  }
  .remix-md pre code { background: none; padding: 0; font-size: 10.5px; line-height: 1.5; }
  .remix-md blockquote {
    margin: 0 0 8px;
    padding-left: 11px;
    border-left: 1px solid rgba(245, 241, 228, 0.22);
    color: ${INK_DIM};
  }
  .remix-md hr {
    border: none;
    border-top: 1px solid rgba(245, 241, 228, 0.14);
    margin: 10px 0;
  }
  .remix-md table { border-collapse: collapse; margin: 0 0 8px; font-size: 11.5px; }
  .remix-md th, .remix-md td {
    border: 1px solid rgba(245, 241, 228, 0.16);
    padding: 4px 8px;
    text-align: left;
  }
  .remix-md th { background: rgba(245, 241, 228, 0.06); font-weight: 600; }
`;
