import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod/v3";
import {
  forgetInThread,
  getThreadMemory,
  rememberInThread,
} from "../../lib/remix-memory.js";

const MEMORY_KINDS = [
  "brief",
  "outline",
  "source",
  "fact",
  "open-question",
] as const;

const rememberSchema = z.object({
  threadId: z.number().int().positive(),
  kind: z.enum(MEMORY_KINDS),
  content: z.string().min(1),
});

const forgetSchema = z.object({
  threadId: z.number().int().positive(),
  id: z.number().int().positive(),
});

/**
 * The working notes a long thread keeps for itself — the brief it was given,
 * the outline it agreed to, the facts it must not contradict.
 *
 * The `remember` composite has been calling this endpoint since it was
 * written; the route itself was never mounted, so every note the agent tried
 * to keep failed at the wire and the tool reported a storage error it could
 * do nothing about. That is the worst shape for a failure to take on a
 * multi-turn task: the model is told its memory works, watches it not work,
 * and has no way to tell the difference between a note it never took and one
 * it took and lost.
 *
 * Rejections stay distinguishable for the same reason. An entry that is empty
 * or over-long is the caller's mistake and says so; a thread that does not
 * exist is a 404 rather than a silent success.
 */
const memoryRoute = new Hono()
  .get("/:threadId", (c) => {
    const threadId = Number(c.req.param("threadId"));
    if (!Number.isInteger(threadId) || threadId <= 0) {
      return c.json({ error: "bad_thread" }, 400);
    }
    return c.json({ entries: getThreadMemory(threadId) });
  })
  .post("/", zValidator("json", rememberSchema), (c) => {
    const { threadId, kind, content } = c.req.valid("json");
    const result = rememberInThread(threadId, kind, content);
    if (!result.ok) {
      return c.json({ error: result.reason ?? "rejected" }, 400);
    }
    return c.json({ ok: true });
  })
  .post("/forget", zValidator("json", forgetSchema), (c) => {
    const { threadId, id } = c.req.valid("json");
    if (!forgetInThread(threadId, id)) {
      return c.json({ error: "not_found" }, 404);
    }
    return c.json({ ok: true });
  });

export default memoryRoute;
