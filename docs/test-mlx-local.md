# Testing MLX Locally

MLX ASR only runs on Apple Silicon macOS.

## Dev App

Use this path to test the same runtime download flow that packaged users get.

```bash
pnpm install
rm -rf ~/.cache/freestyle/mlx-asr/runtime
pnpm --filter @freestyle/electron build:mlx-asr-worker
python3 -m http.server 8765 -d dist
```

In a second terminal:

```bash
FREESTYLE_MLX_ASR_WORKER_URL=http://127.0.0.1:8765/mlx_asr_worker-darwin-arm64.tar.gz \
  pnpm dev
```

Then test in Freestyle:

1. Open Settings -> Models.
2. Press Download on a Qwen3 ASR model.
3. Wait for the MLX runtime and model download to finish.
4. Press Use.
5. Dictate once, then check that transcription works and partial text appears while speaking.

## Packaged App

Build and launch the local macOS app with the same local runtime archive:

```bash
rm -rf ~/.cache/freestyle/mlx-asr/runtime
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm --filter @freestyle/electron build:mac
./scripts/sign_mac_app.sh apps/electron/dist/mac-arm64/Freestyle.app
FREESTYLE_MLX_ASR_WORKER_URL=http://127.0.0.1:8765/mlx_asr_worker-darwin-arm64.tar.gz \
  "apps/electron/dist/mac-arm64/Freestyle.app/Contents/MacOS/Freestyle"
```

If macOS blocks the app, clear quarantine and launch the app binary again:

```bash
xattr -cr apps/electron/dist/mac-arm64/Freestyle.app
```

## Python Fallback

Use this only to test the development fallback without the frozen worker:

```bash
python3.12 -m venv .venv-mlx-asr-dev
. .venv-mlx-asr-dev/bin/activate
pip install mlx-audio "huggingface_hub[hf_xet]"
FREESTYLE_PYTHON="$PWD/.venv-mlx-asr-dev/bin/python" pnpm dev
```

The Models screen should report MLX as available, and Qwen downloads should use
the normal Hugging Face cache.
