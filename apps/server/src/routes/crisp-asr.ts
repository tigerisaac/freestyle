import { Hono } from "hono";
import {
  CRISP_ASR_PROVIDER_ID,
  CRISP_ASR_UNSUPPORTED_PLATFORM_REASON,
  type CrispRuntimeKind,
  isCrispAsrPlatformSupported,
} from "../lib/crisp-asr/constants.js";
import { detectCrispGpuInfo } from "../lib/crisp-asr/gpu.js";
import {
  cancelCrispDownload,
  canRunCrispAsr,
  clearCrispDownloadError,
  deleteCrispModel,
  downloadCrispModel,
  getAllCrispModelStatuses,
  getCrispCatalogModels,
  getCrispModelStatus,
  getCrispRuntimeDownloadStatus,
} from "../lib/crisp-asr/models.js";
import {
  isCrispServerFailed,
  isCrispServerRunning,
  startCrispInBackground,
  stopCrispAsrServer,
} from "../lib/crisp-asr/server.js";
import { getDefaultModels } from "../lib/providers.js";
import { stripProviderPrefix } from "../lib/streaming/types.js";

const crispAsr = new Hono()
  .get("/status", (c) => {
    const supported = isCrispAsrPlatformSupported();
    const runtime = getCrispRuntimeDownloadStatus();
    const gpu = detectCrispGpuInfo(c.req.query("refresh") === "1");

    return c.json({
      platformSupported: supported,
      canRun: canRunCrispAsr(),
      blockedReason: supported ? null : CRISP_ASR_UNSUPPORTED_PLATFORM_REASON,
      serverRunning: isCrispServerRunning(),
      serverFailed: isCrispServerFailed(),
      runtime,
      gpu,
      downloadOptions: [
        {
          kind: "vulkan" as const,
          label: "Vulkan",
          sizeBytes: 27_634_944,
          available: supported,
          recommended: true,
        },
        {
          kind: "cuda" as const,
          label: "CUDA",
          sizeBytes: process.platform === "win32" ? 686_717_941 : 199_925_463,
          available: supported && gpu.hasNvidia,
          recommended: false,
        },
      ],
      models: supported ? getAllCrispModelStatuses() : [],
      modelDefinitions: supported
        ? getCrispCatalogModels().map((model) => ({
            id: model.id,
            displayName: model.displayName,
            family: model.family,
            sizeBytes: model.sizeBytes,
            ramRequired: model.ramRequired,
            speed: model.speed,
            quality: model.quality,
            quantized: model.quantized,
          }))
        : [],
      setupHint: supported
        ? "Download Qwen to install the CrispASR runtime and model weights."
        : CRISP_ASR_UNSUPPORTED_PLATFORM_REASON,
    });
  })
  .post("/models/:model/download", async (c) => {
    const modelId = c.req.param("model");
    const runtimeParam = c.req.query("runtime");
    const runtimeKind =
      runtimeParam === "cuda" || runtimeParam === "vulkan"
        ? (runtimeParam as CrispRuntimeKind)
        : undefined;

    const status = getCrispModelStatus(modelId);
    if (!status) {
      return c.json({ error: `Unknown CrispASR model: ${modelId}` }, 400);
    }

    if (status.status === "ready" && !runtimeKind) {
      return c.json({ ok: true, message: "Model already downloaded" });
    }

    if (status.status === "downloading") {
      return c.json({ ok: true, message: "Download already in progress" });
    }

    clearCrispDownloadError(modelId);
    downloadCrispModel(modelId, runtimeKind).catch(() => {});
    return c.json({ ok: true, message: "Download started" });
  })
  .post("/models/:model/cancel", (c) => {
    const modelId = c.req.param("model");
    return c.json({ ok: cancelCrispDownload(modelId) });
  })
  .delete("/models/:model", async (c) => {
    const modelId = c.req.param("model");
    return c.json({ ok: await deleteCrispModel(modelId) });
  })
  .post("/server/start", async (c) => {
    const body = await c.req
      .json<{ modelId?: string }>()
      .catch(() => ({ modelId: undefined }));
    let modelId = body.modelId;

    if (!modelId) {
      const defaults = getDefaultModels();
      if (defaults.voice?.provider === CRISP_ASR_PROVIDER_ID) {
        modelId = stripProviderPrefix(defaults.voice.model_id);
      }
    }

    if (!modelId) {
      return c.json({ error: "No model specified" }, 400);
    }
    if (getCrispModelStatus(modelId)?.status !== "ready") {
      return c.json({ error: "CrispASR model is not downloaded yet." }, 400);
    }

    startCrispInBackground(modelId);
    return c.json({ ok: true });
  })
  .post("/server/stop", async (c) => {
    await stopCrispAsrServer();
    return c.json({ ok: true });
  });

export default crispAsr;

export function autoStartCrispAsrServer(): void {
  try {
    const defaults = getDefaultModels();
    if (defaults.voice?.provider !== CRISP_ASR_PROVIDER_ID) return;

    const modelId = stripProviderPrefix(defaults.voice.model_id);
    if (getCrispModelStatus(modelId)?.status !== "ready") return;
    startCrispInBackground(modelId);
  } catch {
    // DB not ready — skip
  }
}
