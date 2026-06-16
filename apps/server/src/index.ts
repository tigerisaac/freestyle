import { Hono } from "hono";
import { cors } from "hono/cors";
import { reconcileUnsupportedMlxVoiceDefault } from "./lib/mlx-asr/reconcile.js";
import {
  activateManagedMlxRuntimeForAppVersion,
  prefetchManagedMlxRuntimeForAppRelease,
} from "./lib/mlx-asr/runtime.js";
import { captureException, shutdownPosthog } from "./lib/posthog.js";
import routes from "./routes";
import { autoStartMlxAsrServer } from "./routes/mlx-asr.js";
import { autoStartWhisperServer } from "./routes/whisper.js";

process.on("SIGINT", () => shutdownPosthog().finally(() => process.exit(0)));
process.on("SIGTERM", () => shutdownPosthog().finally(() => process.exit(0)));

const app = new Hono()
  // CORS for renderer requests (skip WebSocket upgrades)
  .use((c, next) => {
    if (c.req.header("upgrade")?.toLowerCase() === "websocket") {
      return next();
    }
    return cors()(c, next);
  })
  .onError((err, c) => {
    captureException(err);
    return c.json({ error: "Internal server error" }, 500);
  })
  .get("/", (c) => c.text("Freestyle API"))
  .route("/", routes);

export { closeDb } from "./lib/db.js";
export { stopMlxServer } from "./lib/mlx-asr/server.js";
export { stopServer as stopWhisperServer } from "./lib/whisper/server.js";
export {
  activateManagedMlxRuntimeForAppVersion,
  autoStartMlxAsrServer,
  autoStartWhisperServer,
  prefetchManagedMlxRuntimeForAppRelease,
  reconcileUnsupportedMlxVoiceDefault,
};

export type AppType = typeof app;

export default app;
