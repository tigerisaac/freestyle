#!/usr/bin/env node
// Ad-hoc sign node-global-key-listener's MacKeyServer so macOS Accessibility
// grants persist across spawns. Without a stable cdhash, TCC re-prompts on
// every launch and the user's "grant + password" never sticks. No-op on
// non-macOS.

import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

if (process.platform !== "darwin") process.exit(0);

const require = createRequire(import.meta.url);

function resolveBinary() {
  try {
    const pkgPath = require.resolve("node-global-key-listener/package.json");
    const candidate = join(dirname(pkgPath), "bin", "MacKeyServer");
    if (existsSync(candidate)) return realpathSync(candidate);
  } catch {}
  return null;
}

const binary = resolveBinary();
if (!binary) {
  console.warn(
    "[fix-keylistener] MacKeyServer not found; skipping (is node-global-key-listener installed?)",
  );
  process.exit(0);
}

try {
  if (!(statSync(binary).mode & 0o111)) chmodSync(binary, 0o755);
} catch (err) {
  console.warn(`[fix-keylistener] chmod failed: ${err.message}`);
}

// Strip quarantine/provenance xattrs — best-effort, ignore "no such xattr".
for (const attr of ["com.apple.quarantine", "com.apple.provenance"]) {
  spawnSync("xattr", ["-d", attr, binary], { stdio: "ignore" });
}

// Ad-hoc sign (identity "-") so the binary gets a stable cdhash. --force
// re-signs if it was already signed; --preserve-metadata keeps entitlements
// if any were ever added.
const result = spawnSync(
  "codesign",
  ["--sign", "-", "--force", "--preserve-metadata=entitlements", binary],
  { stdio: ["ignore", "pipe", "pipe"] },
);

if (result.status !== 0) {
  console.warn(
    `[fix-keylistener] codesign failed (exit ${result.status}): ${result.stderr?.toString().trim()}`,
  );
  process.exit(0);
}

try {
  execFileSync("codesign", ["-dv", binary], { stdio: "ignore" });
  console.log(`[fix-keylistener] ad-hoc signed ${binary}`);
} catch {}
