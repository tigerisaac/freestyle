import { homedir } from "node:os";
import { join } from "node:path";

export const CRISP_ASR_PROVIDER_ID = "local-crispasr";
export const CRISP_ASR_PROVIDER_NAME = "Local Qwen";

export const CRISP_ASR_SERVER_PORT = 8180;
export const CRISP_ASR_RELEASE_TAG = "v0.7.1";

export type CrispRuntimeKind = "vulkan" | "cuda";

export interface CrispRuntimeDef {
  kind: CrispRuntimeKind;
  label: string;
  archiveFileName: string;
  archiveType: "zip" | "tar.gz";
  downloadUrl: string;
  sha256: string;
  sizeBytes: number;
}

export interface CrispAsrModelDef {
  id: string;
  fileName: string;
  displayName: string;
  family: string;
  sizeBytes: number;
  ramRequired: string;
  speed: string;
  quality: string;
  quantized: boolean;
  downloadUrl: string;
  sha256: string;
}

const CRISP_RELEASE_BASE =
  "https://github.com/CrispStrobe/CrispASR/releases/download/v0.7.1";

const RUNTIME_DEFS: Record<
  string,
  Record<string, Record<CrispRuntimeKind, CrispRuntimeDef>>
> = {
  win32: {
    x64: {
      vulkan: {
        kind: "vulkan",
        label: "Vulkan",
        archiveFileName: "crispasr-windows-x86_64-vulkan.zip",
        archiveType: "zip",
        downloadUrl: `${CRISP_RELEASE_BASE}/crispasr-windows-x86_64-vulkan.zip`,
        sha256:
          "6296cb678706803e0ef545f057284c6037e5473d0994b813091dd8bbf84ef269",
        sizeBytes: 27_634_944,
      },
      cuda: {
        kind: "cuda",
        label: "CUDA",
        archiveFileName: "crispasr-windows-x86_64-cuda.zip",
        archiveType: "zip",
        downloadUrl: `${CRISP_RELEASE_BASE}/crispasr-windows-x86_64-cuda.zip`,
        sha256:
          "348a90a71524ccebbb133e6751dd90c355a5d72e2fc9ef8f445097c7377cf863",
        sizeBytes: 686_717_941,
      },
    },
  },
  linux: {
    x64: {
      vulkan: {
        kind: "vulkan",
        label: "Vulkan",
        archiveFileName: "crispasr-linux-x86_64-vulkan.tar.gz",
        archiveType: "tar.gz",
        downloadUrl: `${CRISP_RELEASE_BASE}/crispasr-linux-x86_64-vulkan.tar.gz`,
        sha256:
          "fc8b2fc63099dea10069a76d752c3997e7c5911b8761b429db1991ada7c556e0",
        sizeBytes: 46_011_288,
      },
      cuda: {
        kind: "cuda",
        label: "CUDA",
        archiveFileName: "crispasr-linux-x86_64-cuda.tar.gz",
        archiveType: "tar.gz",
        downloadUrl: `${CRISP_RELEASE_BASE}/crispasr-linux-x86_64-cuda.tar.gz`,
        sha256:
          "865c9483862728385cb6604129c7124f1af51a1e92812a39052a46dba6a95043",
        sizeBytes: 199_925_463,
      },
    },
  },
};

export const CRISP_ASR_MODELS: CrispAsrModelDef[] = [
  {
    id: "qwen3-0.6b-8bit",
    fileName: "qwen3-asr-0.6b-q8_0.gguf",
    displayName: "Qwen3 Fast",
    family: "qwen3-asr",
    sizeBytes: 1_006_809_760,
    ramRequired: "~2 GB",
    speed: "Fast",
    quality: "Better",
    quantized: true,
    downloadUrl:
      "https://huggingface.co/cstr/qwen3-asr-0.6b-GGUF/resolve/f5814fb07a955e84b4474133002cd2bbc747c4b9/qwen3-asr-0.6b-q8_0.gguf?download=true",
    sha256: "f547589d5ca582e093b2d3312ad9ff13b609b43d413f972c0e92b823dde70a00",
  },
];

export const CRISP_ASR_UNSUPPORTED_PLATFORM_REASON =
  "Local Qwen via CrispASR is currently supported on Windows and Linux x64 only.";

export function isCrispAsrPlatformSupported(): boolean {
  return (
    (process.platform === "win32" || process.platform === "linux") &&
    process.arch === "x64"
  );
}

export function getCrispRuntimeDef(
  kind: CrispRuntimeKind,
): CrispRuntimeDef | null {
  return RUNTIME_DEFS[process.platform]?.[process.arch]?.[kind] ?? null;
}

export function getCrispAsrModel(id: string): CrispAsrModelDef | undefined {
  return CRISP_ASR_MODELS.find((model) => model.id === id);
}

export function getCrispCacheDir(): string {
  return join(homedir(), ".cache", "freestyle", "crisp-asr");
}

export function getCrispRuntimeDir(): string {
  return join(
    getCrispCacheDir(),
    "runtime",
    `${process.platform}-${process.arch}`,
  );
}

export function getCrispRuntimeMetadataPath(): string {
  return join(getCrispRuntimeDir(), "runtime.json");
}

export function getCrispModelsDir(): string {
  return join(getCrispCacheDir(), "models");
}

export function getCrispModelPath(model: CrispAsrModelDef): string {
  return join(getCrispModelsDir(), model.fileName);
}

export function getCrispBinaryName(): string {
  return process.platform === "win32" ? "crispasr.exe" : "crispasr";
}

export function getCrispBinaryPath(): string {
  return join(getCrispRuntimeDir(), getCrispBinaryName());
}
