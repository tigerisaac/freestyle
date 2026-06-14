import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { progressFetch } from "../hf/progress.js";
import {
  CRISP_ASR_MODELS,
  CRISP_ASR_UNSUPPORTED_PLATFORM_REASON,
  type CrispAsrModelDef,
  type CrispRuntimeDef,
  type CrispRuntimeKind,
  getCrispAsrModel,
  getCrispBinaryPath,
  getCrispModelPath,
  getCrispModelsDir,
  getCrispRuntimeDef,
  getCrispRuntimeDir,
  getCrispRuntimeMetadataPath,
  isCrispAsrPlatformSupported,
} from "./constants.js";
import { detectCrispGpuInfo } from "./gpu.js";

const execFile = promisify(execFileCallback);

export type CrispDownloadStatus =
  | "not_downloaded"
  | "downloading"
  | "verifying"
  | "ready"
  | "error";

export type CrispDownloadPhase = "building_binary" | "downloading_model";

export interface CrispModelDownloadState {
  model: string;
  fileName: string;
  sizeBytes: number;
  displayName: string;
  status: CrispDownloadStatus;
  phase?: CrispDownloadPhase;
  downloadProgress?: {
    bytesDownloaded: number;
    bytesTotal: number;
    percent: number;
    speedBps: number;
  };
  error?: string;
}

export interface CrispRuntimeMetadata {
  kind: CrispRuntimeKind;
  releaseTag: string;
  installedAt: string;
}

export interface CrispRuntimeDownloadStatus {
  available: boolean;
  kind: CrispRuntimeKind | null;
  status: CrispDownloadStatus;
  sizeBytes?: number;
  downloadProgress?: CrispModelDownloadState["downloadProgress"];
  error?: string;
}

interface ActiveCrispDownload {
  controller: AbortController;
  runtimeKind: CrispRuntimeKind;
  phase: CrispDownloadPhase;
  bytesDownloaded: number;
  bytesTotal: number;
  speedBps: number;
  lastUpdate: number;
  lastBytes: number;
  error?: string;
}

const activeDownloads = new Map<string, ActiveCrispDownload>();

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function baseModelState(
  modelId: string,
  model: CrispAsrModelDef,
): Pick<
  CrispModelDownloadState,
  "model" | "fileName" | "sizeBytes" | "displayName"
> {
  return {
    model: modelId,
    fileName: model.fileName,
    sizeBytes: model.sizeBytes,
    displayName: model.displayName,
  };
}

function buildProgress(active: ActiveCrispDownload) {
  return active.bytesTotal > 0
    ? {
        bytesDownloaded: active.bytesDownloaded,
        bytesTotal: active.bytesTotal,
        percent: Math.round((active.bytesDownloaded / active.bytesTotal) * 100),
        speedBps: active.speedBps,
      }
    : undefined;
}

function readRuntimeMetadata(): CrispRuntimeMetadata | null {
  const metadataPath = getCrispRuntimeMetadataPath();
  try {
    return JSON.parse(
      readFileSync(metadataPath, "utf8"),
    ) as CrispRuntimeMetadata;
  } catch {
    return null;
  }
}

function writeRuntimeMetadata(kind: CrispRuntimeKind): void {
  ensureDir(dirname(getCrispRuntimeMetadataPath()));
  writeFileSync(
    getCrispRuntimeMetadataPath(),
    JSON.stringify(
      {
        kind,
        releaseTag: "v0.7.1",
        installedAt: new Date().toISOString(),
      } satisfies CrispRuntimeMetadata,
      null,
      2,
    ),
  );
}

function isModelFileReady(model: CrispAsrModelDef): boolean {
  const path = getCrispModelPath(model);
  if (!existsSync(path)) return false;
  try {
    return statSync(path).size >= model.sizeBytes * 0.95;
  } catch {
    return false;
  }
}

export function isCrispRuntimeAvailable(
  kind?: CrispRuntimeKind | null,
): boolean {
  const metadata = readRuntimeMetadata();
  if (!metadata) return false;
  if (kind && metadata.kind !== kind) return false;
  if (!existsSync(getCrispBinaryPath())) return false;
  return true;
}

export function getInstalledCrispRuntimeKind(): CrispRuntimeKind | null {
  const metadata = readRuntimeMetadata();
  return isCrispRuntimeAvailable(metadata?.kind ?? null)
    ? (metadata?.kind ?? null)
    : null;
}

export function canRunCrispAsr(): boolean {
  return isCrispAsrPlatformSupported() && existsSync(getCrispBinaryPath());
}

export function getCrispRuntimeDownloadStatus(): CrispRuntimeDownloadStatus {
  const metadata = readRuntimeMetadata();
  const active = Array.from(activeDownloads.values()).find(
    (download) => download.phase === "building_binary",
  );

  if (active?.error && active.phase === "building_binary") {
    return {
      available: false,
      kind: null,
      status: "error",
      sizeBytes: getCrispRuntimeDef(active.runtimeKind)?.sizeBytes,
      error: active.error,
    };
  }

  if (active?.phase === "building_binary") {
    return {
      available: false,
      kind: active.runtimeKind,
      status: "downloading",
      sizeBytes: getCrispRuntimeDef(active.runtimeKind)?.sizeBytes,
      downloadProgress: buildProgress(active),
    };
  }

  const installedKind =
    metadata?.kind && isCrispRuntimeAvailable(metadata.kind)
      ? metadata.kind
      : null;
  if (installedKind) {
    return {
      available: true,
      kind: installedKind,
      status: "ready",
      sizeBytes: getCrispRuntimeDef(installedKind)?.sizeBytes,
    };
  }

  return { available: false, kind: null, status: "not_downloaded" };
}

function resolveRequestedRuntimeKind(
  runtimeKind?: CrispRuntimeKind,
): CrispRuntimeKind {
  const requested = runtimeKind ?? detectCrispGpuInfo().defaultRuntime;
  const runtimeDef = getCrispRuntimeDef(requested);
  if (!runtimeDef) {
    throw new Error(CRISP_ASR_UNSUPPORTED_PLATFORM_REASON);
  }
  if (requested === "cuda" && !detectCrispGpuInfo().hasNvidia) {
    throw new Error("CUDA is only offered when an NVIDIA GPU is detected.");
  }
  return requested;
}

export function getCrispModelStatus(
  modelId: string,
): CrispModelDownloadState | null {
  const model = getCrispAsrModel(modelId);
  if (!model) return null;

  const active = activeDownloads.get(modelId);
  if (active?.error) {
    return {
      ...baseModelState(modelId, model),
      status: "error",
      error: active.error,
    };
  }

  if (active) {
    return {
      ...baseModelState(modelId, model),
      status: "downloading",
      phase: active.phase,
      downloadProgress: buildProgress(active),
    };
  }

  if (!isCrispAsrPlatformSupported()) {
    return {
      ...baseModelState(modelId, model),
      status: "error",
      error: CRISP_ASR_UNSUPPORTED_PLATFORM_REASON,
    };
  }

  if (isModelFileReady(model) && isCrispRuntimeAvailable()) {
    return {
      ...baseModelState(modelId, model),
      status: "ready",
    };
  }

  return {
    ...baseModelState(modelId, model),
    status: "not_downloaded",
  };
}

export function getAllCrispModelStatuses(): CrispModelDownloadState[] {
  return CRISP_ASR_MODELS.map((model) => getCrispModelStatus(model.id)!);
}

export function getCrispCatalogModels(): CrispAsrModelDef[] {
  return CRISP_ASR_MODELS;
}

export function getDownloadedCrispModelPath(modelId: string): string | null {
  const model = getCrispAsrModel(modelId);
  if (!model || !isModelFileReady(model)) return null;
  return getCrispModelPath(model);
}

export function clearCrispDownloadError(modelId: string): void {
  const active = activeDownloads.get(modelId);
  if (active?.error) {
    activeDownloads.delete(modelId);
  }
}

export async function downloadCrispModel(
  modelId: string,
  runtimeKind?: CrispRuntimeKind,
): Promise<void> {
  const model = getCrispAsrModel(modelId);
  if (!model) throw new Error(`Unknown CrispASR model: ${modelId}`);
  if (!isCrispAsrPlatformSupported()) {
    throw new Error(CRISP_ASR_UNSUPPORTED_PLATFORM_REASON);
  }

  const requestedRuntimeKind = resolveRequestedRuntimeKind(runtimeKind);

  const existing = activeDownloads.get(modelId);
  if (existing && !existing.error) {
    throw new Error(`Model ${modelId} is already downloading`);
  }
  if (existing?.error) {
    activeDownloads.delete(modelId);
  }

  if (
    isModelFileReady(model) &&
    isCrispRuntimeAvailable(requestedRuntimeKind)
  ) {
    return;
  }

  const now = Date.now();
  const active: ActiveCrispDownload = {
    controller: new AbortController(),
    runtimeKind: requestedRuntimeKind,
    phase: "building_binary",
    bytesDownloaded: 0,
    bytesTotal: 0,
    speedBps: 0,
    lastUpdate: now,
    lastBytes: 0,
  };
  activeDownloads.set(modelId, active);

  try {
    if (!isCrispRuntimeAvailable(requestedRuntimeKind)) {
      await installRuntime(requestedRuntimeKind, active);
    }

    active.phase = "downloading_model";
    active.bytesDownloaded = 0;
    active.bytesTotal = model.sizeBytes;
    active.speedBps = 0;
    active.lastUpdate = Date.now();
    active.lastBytes = 0;

    if (!isModelFileReady(model)) {
      await downloadModelFile(model, active);
    }

    activeDownloads.delete(modelId);
  } catch (err) {
    if (active.controller.signal.aborted) {
      activeDownloads.delete(modelId);
      return;
    }
    active.error = err instanceof Error ? err.message : String(err);
    throw err;
  }
}

export function cancelCrispDownload(modelId: string): boolean {
  const active = activeDownloads.get(modelId);
  if (!active) return false;
  active.controller.abort();
  activeDownloads.delete(modelId);
  return true;
}

export async function deleteCrispModel(modelId: string): Promise<boolean> {
  const model = getCrispAsrModel(modelId);
  if (!model) return false;

  cancelCrispDownload(modelId);
  await stopServerBeforeMutation();

  const modelPath = getCrispModelPath(model);
  try {
    if (existsSync(modelPath)) {
      unlinkSync(modelPath);
      return true;
    }
  } catch {}
  return false;
}

async function installRuntime(
  runtimeKind: CrispRuntimeKind,
  active: ActiveCrispDownload,
): Promise<void> {
  const runtimeDef = getCrispRuntimeDef(runtimeKind);
  if (!runtimeDef) {
    throw new Error(CRISP_ASR_UNSUPPORTED_PLATFORM_REASON);
  }

  await stopServerBeforeMutation();

  const runtimeDir = getCrispRuntimeDir();
  const tmpRoot = join(runtimeDir, "..", `.${runtimeKind}-installing`);
  const archivePath = join(tmpRoot, runtimeDef.archiveFileName);
  const extractDir = join(tmpRoot, "extract");

  rmSync(tmpRoot, { recursive: true, force: true });
  ensureDir(tmpRoot);

  try {
    active.bytesDownloaded = 0;
    active.bytesTotal = runtimeDef.sizeBytes;
    active.speedBps = 0;
    active.lastUpdate = Date.now();
    active.lastBytes = 0;

    await downloadFile(runtimeDef.downloadUrl, archivePath, active);
    await verifyFileDigest(
      archivePath,
      runtimeDef.sha256,
      runtimeDef.archiveFileName,
    );
    await extractRuntimeArchive(runtimeDef, archivePath, extractDir);
    installExtractedRuntime(extractDir, runtimeDir);
    writeRuntimeMetadata(runtimeKind);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function downloadModelFile(
  model: CrispAsrModelDef,
  active: ActiveCrispDownload,
): Promise<void> {
  const modelsDir = getCrispModelsDir();
  ensureDir(modelsDir);

  const destPath = getCrispModelPath(model);
  const tempPath = `${destPath}.downloading`;

  try {
    await downloadFile(model.downloadUrl, tempPath, active);
    await verifyFileDigest(tempPath, model.sha256, model.fileName);
    renameSync(tempPath, destPath);
  } catch (err) {
    try {
      if (existsSync(tempPath)) unlinkSync(tempPath);
    } catch {}
    throw err;
  }
}

async function downloadFile(
  url: string,
  destination: string,
  active: ActiveCrispDownload,
): Promise<void> {
  const res = await progressFetch(active, active.controller.signal)(url);
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: HTTP ${res.status}`);
  }
  const total = Number(res.headers.get("content-length"));
  if (total > 0) active.bytesTotal = total;
  await pipeline(webBodyToReadable(res.body), createWriteStream(destination));
}

async function verifyFileDigest(
  filePath: string,
  expectedSha256: string,
  label: string,
): Promise<void> {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  const digest = hash.digest("hex");
  if (digest !== expectedSha256) {
    throw new Error(`Checksum mismatch for ${label}`);
  }
}

async function extractRuntimeArchive(
  runtimeDef: CrispRuntimeDef,
  archivePath: string,
  extractDir: string,
): Promise<void> {
  ensureDir(extractDir);

  if (runtimeDef.archiveType === "zip") {
    await execFile(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Expand-Archive -Force -LiteralPath '${archivePath.replaceAll("'", "''")}' -DestinationPath '${extractDir.replaceAll("'", "''")}'`,
      ],
      { timeout: 120_000 },
    );
    return;
  }

  await execFile("tar", ["-xzf", archivePath, "-C", extractDir], {
    timeout: 120_000,
  });
}

function installExtractedRuntime(extractDir: string, runtimeDir: string): void {
  const topLevel = readdirSync(extractDir, { withFileTypes: true });
  const sourceRoot =
    topLevel.length === 1 && topLevel[0]?.isDirectory()
      ? join(extractDir, topLevel[0].name)
      : extractDir;

  rmSync(runtimeDir, { recursive: true, force: true });
  ensureDir(dirname(runtimeDir));
  renameSync(sourceRoot, runtimeDir);

  const binaryPath = getCrispBinaryPath();
  if (existsSync(binaryPath) && process.platform !== "win32") {
    chmodSync(binaryPath, 0o755);
  }
}

function webBodyToReadable(body: ReadableStream<Uint8Array>): Readable {
  const reader = body.getReader();
  return new Readable({
    async read() {
      try {
        const { done, value } = await reader.read();
        if (done) {
          this.push(null);
          return;
        }
        this.push(Buffer.from(value));
      } catch (err) {
        this.destroy(err instanceof Error ? err : new Error(String(err)));
      }
    },
  });
}

async function stopServerBeforeMutation(): Promise<void> {
  const { stopCrispAsrServer } = await import("./server.js");
  await stopCrispAsrServer().catch(() => undefined);
}
