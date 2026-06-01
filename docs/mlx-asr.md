# Local MLX ASR

Freestyle can run **on-device speech models** via [mlx-audio](https://github.com/Blaizzy/mlx-audio) on Apple Silicon. The catalog is defined in `MLX_ASR_MODELS` (today: Qwen3-ASR variants); any Hugging Face repo that `mlx_audio.stt.load()` supports can be added there.

## Requirements

- macOS with Apple Silicon (M1+)
- Packaged app: downloaded `mlx_asr_worker` runtime
- Development fallback: Python 3.12+ with `pip install mlx-audio`

Optional: set `FREESTYLE_PYTHON` to a virtualenv `python` if it is not on `PATH`.
Optional: set `FREESTYLE_MLX_ASR_WORKER` to a frozen worker executable.

## Setup

Packaged app:

- Open **Settings -> Models -> Voice**
- Press **Download** on a Qwen3 ASR row
- Press **Use** after the download finishes

Development fallback:

```bash
python3 -m pip install mlx-audio "huggingface_hub[hf_xet]"
```

Model weights download from Hugging Face into the normal HF cache.

## Vocabulary / keywords

Vocabulary terms are passed to Qwen3 ASR as context when using `local-mlx`.
The MLX path builds on the shared ASR vocabulary-bias pipeline and sends terms
as `Technical terms: ...` so Qwen can prefer names, brands, and phrases the user
has saved.

## Architecture

- Node spawns `scripts/mlx_asr_server.py` (or frozen `mlx_asr_worker`) with `--model <hf-id>`
- One worker process loads one model at startup; switching models restarts the worker
- Packaged builds download the frozen worker on demand; users do not need system Python
- Audio is written to a temporary WAV/PCM file and sent to the worker by path
- Settings -> Models -> MLX memory controls how long the worker stays up after a request

### Adding or swapping models (e.g. Parakeet instead of Qwen)

The worker script is **not Qwen-specific**. It calls `mlx_audio.stt.load(hf_id)`
for the model passed on `--model`.

1. Add a catalog entry in `MLX_ASR_MODELS` (`apps/server/src/lib/mlx-asr/constants.ts`):
   `id`, `hfId` (Hugging Face repo), `family`, display metadata.
2. Users download weights from the Models screen (same as today).
3. Re-publish the frozen worker only when `scripts/mlx_asr_server.py` or
   mlx-audio deps change, not when adding a new `hfId` to the catalog.

Dev smoke test with any mlx-audio STT model:

```bash
python3 scripts/mlx_asr_server.py --model <hf-repo-id> --download-model
python3 scripts/mlx_asr_server.py --model <hf-repo-id>
# then send transcribe JSON lines on stdin
```

## Development

```bash
# Status
curl http://127.0.0.1:PORT/api/mlx-asr/status

# Start worker manually
python3 scripts/mlx_asr_server.py --model mlx-community/Qwen3-ASR-0.6B-5bit
```
