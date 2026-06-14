import { execFileSync } from "node:child_process";
import type { CrispRuntimeKind } from "./constants.js";

export interface CrispGpuInfo {
  hasNvidia: boolean;
  names: string[];
  source: string;
  defaultRuntime: CrispRuntimeKind;
}

let cachedGpuInfo: { value: CrispGpuInfo; expiresAt: number } | null = null;
const GPU_INFO_TTL_MS = 30_000;

function run(command: string, args: string[]): string | null {
  try {
    return execFileSync(command, args, {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

function cleanLines(text: string | null): string[] {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function fallbackInfo(source: string): CrispGpuInfo {
  return {
    hasNvidia: false,
    names: [],
    source,
    defaultRuntime: "vulkan",
  };
}

export function detectCrispGpuInfo(forceRefresh = false): CrispGpuInfo {
  const now = Date.now();
  if (!forceRefresh && cachedGpuInfo && cachedGpuInfo.expiresAt > now) {
    return cachedGpuInfo.value;
  }

  const directNvidia = cleanLines(
    run("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"]),
  );
  if (directNvidia.length > 0) {
    const value: CrispGpuInfo = {
      hasNvidia: true,
      names: directNvidia,
      source: "nvidia-smi",
      defaultRuntime: "vulkan",
    };
    cachedGpuInfo = { value, expiresAt: now + GPU_INFO_TTL_MS };
    return value;
  }

  if (process.platform === "win32") {
    const powershell = cleanLines(
      run("powershell", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name",
      ]),
    );
    const hasNvidia = powershell.some((line) => /nvidia/i.test(line));
    const value: CrispGpuInfo = {
      hasNvidia,
      names: powershell,
      source: powershell.length > 0 ? "powershell" : "unknown",
      defaultRuntime: "vulkan",
    };
    cachedGpuInfo = { value, expiresAt: now + GPU_INFO_TTL_MS };
    return value;
  }

  if (process.platform === "linux") {
    const lspci = cleanLines(
      run("sh", [
        "-lc",
        "lspci 2>/dev/null | grep -Ei 'VGA|3D|Display' || true",
      ]),
    );
    const hasNvidia = lspci.some((line) => /nvidia/i.test(line));
    const value: CrispGpuInfo = {
      hasNvidia,
      names: lspci,
      source: lspci.length > 0 ? "lspci" : "unknown",
      defaultRuntime: "vulkan",
    };
    cachedGpuInfo = { value, expiresAt: now + GPU_INFO_TTL_MS };
    return value;
  }

  const value = fallbackInfo("unknown");
  cachedGpuInfo = { value, expiresAt: now + GPU_INFO_TTL_MS };
  return value;
}
