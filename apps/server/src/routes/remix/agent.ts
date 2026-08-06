import { createAppLogger } from "@freestyle-voice/utils";
import { remixAgentRequestSchema } from "@freestyle-voice/validations";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import {
  FREESTYLE_CLOUD_PROVIDER_ID,
  freestyleCloudUrl,
} from "../../lib/freestyle-cloud.js";
import { getDefaultModels } from "../../lib/providers.js";
import { runRemixAgentLocally } from "../../lib/remix-agent.js";
import { getThreadMemory, renderThreadMemory } from "../../lib/remix-memory.js";
import { getActiveThread } from "../../lib/remix-store.js";
import { getSessionToken, invalidateSession } from "../../lib/sessions.js";
import { isCleanupModelSupported } from "../models.js";

const log = createAppLogger("remix-agent");

/** Remix can target a local Worker without rerouting managed STT or cleanup. */
function remixCloudUrl(): string {
  return (process.env.FREESTYLE_REMIX_CLOUD_URL || freestyleCloudUrl()).replace(
    /\/$/,
    "",
  );
}

/** A shared token may replace cloud sign-in only for an explicit loopback dev Worker. */
function localRemixDevToken(): string | null {
  if (process.env.FREESTYLE_ENV !== "development") return null;
  const token = process.env.REMIX_DEV_TOKEN?.trim();
  if (!token) return null;
  try {
    const hostname = new URL(remixCloudUrl()).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" ? token : null;
  } catch {
    return null;
  }
}

/**
 * One agent turn. On Freestyle Cloud the loop runs on the Worker and this
 * route is a streaming proxy — the renderer never holds the cloud token, so
 * the Bearer header is injected here from the server-side session. On BYOK
 * the same loop runs in-process.
 */
const agentRoute = new Hono().post(
  "/",
  zValidator("json", remixAgentRequestSchema),
  async (c) => {
    const body = c.req.valid("json");
    // Both lanes read the same local memory; only the BYOK lane can be handed
    // the id, so the cloud lane gets the rendered text injected below.
    const threadId = getActiveThread()?.id;
    const threadMemory = threadId
      ? renderThreadMemory(getThreadMemory(threadId))
      : "";
    const llm = getDefaultModels().llm;
    if (!llm) {
      return c.json(
        {
          error: "no-model",
          detail: "No AI model is set up yet. Pick one in Settings > Models.",
        },
        400,
      );
    }

    if (llm.provider === FREESTYLE_CLOUD_PROVIDER_ID) {
      const devToken = localRemixDevToken();
      // Never forward a production session token to a local development
      // Worker. The shared dev token is the only credential it needs.
      const token = devToken ? null : getSessionToken();
      if (!token && !devToken) {
        return c.json({ error: "cloud_auth_required" }, 401);
      }

      let upstream: Response;
      try {
        upstream = await fetch(`${remixCloudUrl()}/v2/remix`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(devToken ? { "X-Freestyle-Remix-Dev": devToken } : {}),
          },
          body: JSON.stringify({
            messages: body.messages,
            // The thread's memory is injected here rather than sent by the
            // renderer: it lives in this process's SQLite, and Freestyle
            // Cloud stores none of it. The Worker receives it as context for
            // one request and keeps nothing, exactly as it does the selection.
            context: { ...body.context, memory: threadMemory || undefined },
            skills: body.skills,
          }),
          signal: c.req.raw.signal,
        });
      } catch (err) {
        log.error(`Remix cloud request failed: ${err}`);
        return c.json(
          { error: "failed", detail: "Couldn't reach Freestyle Cloud." },
          502,
        );
      }

      if (upstream.status === 401) {
        invalidateSession();
        return c.json({ error: "cloud_auth_required" }, 401);
      }
      if (upstream.status === 429) {
        const payload = (await upstream.json().catch(() => null)) as {
          resetsAt?: string;
        } | null;
        return c.json(
          { error: "usage_exceeded", resetsAt: payload?.resetsAt },
          429,
        );
      }
      if (!upstream.ok || !upstream.body) {
        const detail = await upstream.text().catch(() => "");
        log.error(
          `Remix cloud returned ${upstream.status}: ${detail.slice(0, 200)}`,
        );
        return c.json(
          { error: "failed", detail: "Remix failed upstream." },
          502,
        );
      }

      // The UI message stream passes through byte-for-byte. The skill
      // headers are forwarded with it so the pill's chip behaves the same
      // whether the loop ran on the Worker or in this process.
      const passthrough: Record<string, string> = {
        "Content-Type":
          upstream.headers.get("Content-Type") ?? "text/event-stream",
        "Cache-Control": "no-cache",
        "x-vercel-ai-ui-message-stream": "v1",
      };
      for (const header of ["X-Freestyle-Skill", "X-Freestyle-Skill-Label"]) {
        const value = upstream.headers.get(header);
        if (value) passthrough[header] = value;
      }
      return new Response(upstream.body, { headers: passthrough });
    }

    if (!(await isCleanupModelSupported(llm.provider, llm.model_id))) {
      return c.json(
        {
          error: "unsupported-model",
          detail: `${llm.model_id} can't run Remix. Pick a different model in Settings > Models.`,
        },
        400,
      );
    }

    try {
      return await runRemixAgentLocally(
        body,
        llm,
        c.req.raw.signal,
        body.skills,
        threadId,
      );
    } catch (err) {
      log.error(`Remix agent (BYOK) failed: ${err}`);
      return c.json(
        {
          error: "failed",
          detail: err instanceof Error ? err.message : "Remix failed.",
        },
        502,
      );
    }
  },
);

export default agentRoute;
