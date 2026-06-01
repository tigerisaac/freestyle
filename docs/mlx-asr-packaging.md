# Packaging Local MLX ASR

Do not rely on macOS system Python for the DMG. Modern macOS does not provide a
guaranteed Python runtime for apps, and `/usr/bin/python3` may be only a
developer-tools stub.

The shippable path is:

1. Build a standalone `mlx_asr_worker` archive on Apple Silicon.
2. Upload it as a GitHub release asset.
3. Keep `scripts/mlx_asr_server.py` as the development fallback.
4. Let the app download the worker and Qwen3 ASR weights on first Qwen model
   download.

The app now resolves the worker in this order:

- `FREESTYLE_MLX_ASR_WORKER`
- downloaded worker in `~/.cache/freestyle/mlx-asr/runtime/darwin-arm64`
- `process.resourcesPath/mlx-asr/mlx_asr_worker/mlx_asr_worker`
- `process.resourcesPath/mlx-asr/mlx_asr_worker`
- local development `dist/mlx-asr/mlx_asr_worker` candidates
- fallback Python script via `FREESTYLE_PYTHON` or a Python that already has
  `mlx-audio`

PyInstaller can freeze the worker with the CPython interpreter and imported
packages, so the end user does not need to install Python or `mlx-audio`. The
archive is intentionally **not bundled in the DMG** because it bloats the app
by hundreds of MB.

Build the worker archive separately from the DMG. Maintainers can run the
manual **MLX ASR Runtime** GitHub Actions workflow with `publish=true`; it
builds the archive and uploads it to the fixed runtime release.

Local equivalent:

```bash
pnpm --filter @freestyle/electron build:mlx-asr-worker
```

It writes:

```text
dist/mlx_asr_worker-darwin-arm64.tar.gz
```

The app downloads that asset from:

```text
https://github.com/freestyle-voice/freestyle/releases/download/mlx-asr-worker-v1/mlx_asr_worker-darwin-arm64.tar.gz
```

Override locally with `FREESTYLE_MLX_ASR_WORKER_URL`.

This is not required for every Freestyle app release. Re-publish the runtime
asset only when `scripts/mlx_asr_server.py`, MLX runtime dependencies, or Python
version changes. Adding a new Hugging Face model to `MLX_ASR_MODELS` (Qwen, Parakeet,
etc.) does **not** require republishing the worker — the same binary passes `--model`.

App releases and `mlx-asr-worker-v1` are independent: ship app updates through Craft;
ship worker updates through the **MLX ASR Runtime** workflow with `publish=true`.

### Local unsigned worker builds

If you disable Apple signing (`CSC_IDENTITY_AUTO_DISCOVERY=false`), you must still
**ad-hoc sign the worker** or Qwen will fail at runtime:

```bash
codesign --deep --force --sign - "dist/mlx_asr_worker"
```

`build_mlx_asr_worker.sh` already ad-hoc signs the worker bundle.

Symptom when signing is wrong: `mlx_asr_worker` cannot load
`libpython3.12.dylib` (Team ID / code signature errors in Console).

Users only need to press Download on a Qwen3 row. Freestyle first downloads the
worker archive into its cache, then downloads model weights into Hugging Face's
cache. No Python install is needed.

To test the distributed path before publishing the fixed release asset:

```bash
pnpm --filter @freestyle/electron build:mlx-asr-worker
python3 -m http.server 8765 -d dist
FREESTYLE_MLX_ASR_WORKER_URL=http://127.0.0.1:8765/mlx_asr_worker-darwin-arm64.tar.gz \
  "/Applications/Freestyle.app/Contents/MacOS/Freestyle"
```

For the exact end-user path, publish the runtime asset first, then install a
signed/notarized app build normally and press Download on a Qwen3 row.

The model weights are still an unavoidable size question. Qwen3 ASR is a real
local model, so the app must either ship selected weights inside the DMG or
download them on first use. This PR keeps the DMG smaller and downloads weights
from the Models screen.
