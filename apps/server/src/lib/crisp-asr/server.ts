import { Buffer } from "node:buffer";
import { type ChildProcess, spawn } from "node:child_process";
import { createAppLogger } from "@freestyle/utils";
import {
  CRISP_ASR_SERVER_PORT,
  type CrispRuntimeKind,
  getCrispBinaryPath,
} from "./constants.js";
import {
  canRunCrispAsr,
  getDownloadedCrispModelPath,
  getInstalledCrispRuntimeKind,
} from "./models.js";

const log = createAppLogger("crisp-asr");
const serverLog = createAppLogger("crisp-asr-server");
const START_TIMEOUT_MS = 120_000;
const TRANSCRIBE_TIMEOUT_MS = 300_000;
const KEEP_ALIVE_MS = 10 * 60_000;

let serverProcess: ChildProcess | null = null;
let currentModelId: string | null = null;
let currentRuntimeKind: CrispRuntimeKind | null = null;
let serverReady = false;
let serverFailed = false;
let startPromise: Promise<void> | null = null;
let lifecyclePromise: Promise<void> = Promise.resolve();
let activeRequests = 0;
let unloadTimer: ReturnType<typeof setTimeout> | null = null;

function stopServerOnExit(): void {
  const proc = serverProcess;
  if (!proc) return;
  try {
    proc.kill(process.platform === "win32" ? undefined : "SIGTERM");
  } catch {}
}

process.once("exit", stopServerOnExit);

export function isCrispServerRunning(): boolean {
  return serverProcess !== null && serverReady;
}

export function isCrispServerFailed(): boolean {
  return serverFailed;
}

export function getCrispServerPort(): number {
  return CRISP_ASR_SERVER_PORT;
}

export function startCrispInBackground(modelId: string): void {
  if (!canRunCrispAsr()) return;
  if (serverProcess && currentModelId === modelId && serverReady) return;
  if (startPromise && currentModelId === modelId) return;

  serverFailed = false;
  ensureCrispServerRunning(modelId)
    .then(() => {
      log.info(`Server ready on port ${CRISP_ASR_SERVER_PORT}`);
    })
    .catch((err: Error) => {
      log.error(`Background server start failed: ${err.message}`);
    });
}

export function applyCrispAsrRetentionPolicy(): void {
  if (!serverProcess) return;
  if (startPromise || activeRequests > 0) return;
  clearUnloadTimer();
  unloadTimer = setTimeout(() => {
    stopCrispAsrServer().catch(() => undefined);
  }, KEEP_ALIVE_MS);
}

export function ensureCrispServerRunning(modelId: string): Promise<void> {
  const run = lifecyclePromise.then(() =>
    ensureCrispServerRunningLocked(modelId),
  );
  lifecyclePromise = run.catch(() => undefined);
  return run;
}

async function ensureCrispServerRunningLocked(modelId: string): Promise<void> {
  clearUnloadTimer();

  const runtimeKind = getInstalledCrispRuntimeKind();
  if (!runtimeKind) {
    throw new Error("CrispASR runtime is not installed yet.");
  }

  if (
    serverProcess &&
    currentModelId === modelId &&
    currentRuntimeKind === runtimeKind &&
    serverReady
  ) {
    return;
  }

  if (
    startPromise &&
    currentModelId === modelId &&
    currentRuntimeKind === runtimeKind
  ) {
    return startPromise;
  }

  await stopCrispAsrServer();
  serverFailed = false;
  currentModelId = modelId;
  currentRuntimeKind = runtimeKind;

  const promise = startServer(modelId, runtimeKind);
  startPromise = promise;
  try {
    await promise;
  } finally {
    if (startPromise === promise) {
      startPromise = null;
    }
  }
}

export async function transcribeWithCrispAsr(opts: {
  modelId: string;
  audio: Uint8Array;
  language?: string;
  context?: string;
  deferUnload?: boolean;
}): Promise<string> {
  await ensureCrispServerRunning(opts.modelId);
  activeRequests++;
  try {
    return await postToCrispServer({
      audio: opts.audio,
      language: opts.language,
      context: opts.context,
    });
  } catch (err) {
    log.warn(
      `inference failed, restarting server: ${err instanceof Error ? err.message : String(err)}`,
    );
    await ensureCrispServerRunning(opts.modelId);
    return await postToCrispServer({
      audio: opts.audio,
      language: opts.language,
      context: opts.context,
    });
  } finally {
    activeRequests = Math.max(0, activeRequests - 1);
    if (!opts.deferUnload) applyCrispAsrRetentionPolicy();
  }
}

export async function transcribePcmWithCrispAsr(opts: {
  modelId: string;
  pcm: Uint8Array;
  sampleRate: number;
  language?: string;
  context?: string;
  deferUnload?: boolean;
}): Promise<string> {
  const wav = wrapPcm16LeAsWav(opts.pcm, opts.sampleRate);
  return transcribeWithCrispAsr({
    modelId: opts.modelId,
    audio: wav,
    language: opts.language,
    context: opts.context,
    deferUnload: opts.deferUnload,
  });
}

async function startServer(
  modelId: string,
  runtimeKind: CrispRuntimeKind,
): Promise<void> {
  const binaryPath = getCrispBinaryPath();
  const modelPath = getDownloadedCrispModelPath(modelId);
  if (!modelPath) {
    throw new Error(`CrispASR model "${modelId}" is not downloaded`);
  }

  serverReady = false;
  const args = [
    "--server",
    "--host",
    "127.0.0.1",
    "--port",
    String(CRISP_ASR_SERVER_PORT),
    "--gpu-backend",
    runtimeKind,
    "--model",
    modelPath,
  ];

  const proc = spawn(binaryPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    ...crispSpawnEnv(binaryPath),
  });
  serverProcess = proc;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let stderr = "";
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      const detail = stderr.trim().slice(-1000);
      try {
        proc.kill();
      } catch {}
      reject(
        new Error(
          `CrispASR failed to start within ${START_TIMEOUT_MS / 1000}s. Last output:\n${detail}`,
        ),
      );
    }, START_TIMEOUT_MS);

    const onReady = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      serverReady = true;
      resolve();
    };

    const healthCheckInterval: ReturnType<typeof setInterval> | null =
      setInterval(async () => {
        if (settled) {
          if (healthCheckInterval) clearInterval(healthCheckInterval);
          return;
        }
        try {
          const res = await fetch(
            `http://127.0.0.1:${CRISP_ASR_SERVER_PORT}/health`,
            { signal: AbortSignal.timeout(1000) },
          );
          if (res.ok) {
            onReady();
          }
        } catch {}
      }, 250);

    proc.stdout?.on("data", (data: Buffer) => {
      serverLog.debug(`stdout: ${data.toString().trimEnd()}`);
    });
    proc.stderr?.on("data", (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      serverLog.debug(`stderr: ${text.trimEnd()}`);
    });

    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (healthCheckInterval) clearInterval(healthCheckInterval);
      serverProcess = null;
      currentModelId = null;
      currentRuntimeKind = null;
      reject(new Error(`Failed to start CrispASR: ${err.message}`));
    });

    proc.on("close", (code) => {
      clearTimeout(timeout);
      if (healthCheckInterval) clearInterval(healthCheckInterval);
      const detail = stderr.trim() || `exit code ${code}`;
      serverProcess = null;
      serverReady = false;

      if (!settled) {
        settled = true;
        currentModelId = null;
        currentRuntimeKind = null;
        serverFailed = true;
        reject(new Error(`CrispASR exited unexpectedly: ${detail}`));
        return;
      }

      serverFailed = true;
      log.warn(`CrispASR server exited: ${detail}`);
    });
  });
}

export async function stopCrispAsrServer(): Promise<void> {
  startPromise = null;
  clearUnloadTimer();

  const proc = serverProcess;
  serverProcess = null;
  serverReady = false;
  currentModelId = null;
  currentRuntimeKind = null;

  if (!proc) return;

  await new Promise<void>((resolve) => {
    const done = () => resolve();
    proc.once("close", done);
    try {
      proc.kill(process.platform === "win32" ? undefined : "SIGTERM");
    } catch {
      resolve();
    }
    setTimeout(resolve, 3000);
  });
}

async function postToCrispServer(opts: {
  audio: Uint8Array;
  language?: string;
  context?: string;
}): Promise<string> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([Buffer.from(opts.audio)], { type: "audio/wav" }),
    "a.wav",
  );
  form.append("response_format", "json");
  form.append("temperature", "0");
  form.append("no_timestamps", "true");
  if (opts.language) {
    form.append("language", opts.language);
  } else {
    form.append("detect_language", "true");
  }
  if (opts.context?.trim()) {
    form.append("prompt", opts.context.trim());
  }

  const res = await fetch(
    `http://127.0.0.1:${CRISP_ASR_SERVER_PORT}/v1/audio/transcriptions`,
    {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`CrispASR inference failed: HTTP ${res.status} ${detail}`);
  }

  const data = (await res.json()) as { text?: string };
  return data.text?.trim() ?? "";
}

function clearUnloadTimer(): void {
  if (unloadTimer) {
    clearTimeout(unloadTimer);
    unloadTimer = null;
  }
}

function crispSpawnEnv(binaryPath: string): {
  cwd: string;
  env: NodeJS.ProcessEnv;
} {
  const runtimeDir = binaryPath.replace(/[\\/][^\\/]+$/, "");
  return {
    cwd: runtimeDir,
    env: {
      ...process.env,
      PATH: `${runtimeDir}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
      LD_LIBRARY_PATH:
        process.platform === "linux"
          ? `${runtimeDir}:${process.env.LD_LIBRARY_PATH ?? ""}`
          : process.env.LD_LIBRARY_PATH,
    },
  };
}

function wrapPcm16LeAsWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const byteRate = sampleRate * 2;
  const blockAlign = 2;

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, pcm.byteLength, true);

  const out = new Uint8Array(44 + pcm.byteLength);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}
