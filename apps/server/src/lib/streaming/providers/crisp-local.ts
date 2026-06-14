import { CRISP_ASR_PROVIDER_ID } from "../../crisp-asr/constants.js";
import { getCrispModelStatus } from "../../crisp-asr/models.js";
import {
  applyCrispAsrRetentionPolicy,
  ensureCrispServerRunning,
  transcribePcmWithCrispAsr,
  transcribeWithCrispAsr,
} from "../../crisp-asr/server.js";
import type {
  StreamCallbacks,
  StreamingSessionOptions,
  StreamSession,
  TranscribeOptions,
  TranscribeResult,
  TranscriptionProvider,
} from "../types.js";
import { stripProviderPrefix } from "../types.js";

const STREAM_SAMPLE_RATE = 16_000;

export class CrispLocalTranscriptionProvider implements TranscriptionProvider {
  readonly providerId = CRISP_ASR_PROVIDER_ID;

  async transcribe(opts: TranscribeOptions): Promise<TranscribeResult> {
    const modelId = stripProviderPrefix(opts.model);
    if (getCrispModelStatus(modelId)?.status !== "ready") {
      throw new Error("CrispASR model is not downloaded yet.");
    }

    const text = await transcribeWithCrispAsr({
      modelId,
      audio: opts.audio,
      language: opts.language,
      context: opts.bias?.kind === "prompt" ? opts.bias.text : undefined,
    });

    return { text: text.trim() };
  }

  supportsStreaming(_modelId: string): boolean {
    return false;
  }

  supportsSessionTransport(_modelId: string): boolean {
    return true;
  }

  openStreamingSession(opts: StreamingSessionOptions): StreamSession {
    const modelId = stripProviderPrefix(opts.model);
    return new CrispLocalSessionTransport({
      modelId,
      language: opts.language,
      context: opts.bias?.kind === "prompt" ? opts.bias.text : undefined,
      callbacks: opts.callbacks,
    });
  }
}

class CrispLocalSessionTransport implements StreamSession {
  private chunks: Buffer[] = [];
  private sampleCount = 0;
  private closed = false;
  private canceled = false;
  private inFlight = false;
  private committed = false;
  private generation = 0;
  private readyPromise: Promise<void> = Promise.resolve();

  constructor(
    private readonly opts: {
      modelId: string;
      language?: string;
      context?: string;
      callbacks: StreamCallbacks;
    },
  ) {
    this.startLoad();
  }

  sendAudio(chunk: ArrayBuffer): void {
    if (this.closed || this.canceled) return;
    const buf = Buffer.from(chunk);
    this.chunks.push(buf);
    this.sampleCount += Math.floor(buf.byteLength / 2);
  }

  reset(): void {
    this.chunks = [];
    this.sampleCount = 0;
    this.canceled = false;
    this.inFlight = false;
    this.committed = false;
    this.generation++;
    this.startLoad();
  }

  waitUntilReady(): Promise<void> {
    return this.readyPromise;
  }

  commit(): void {
    if (this.committed || this.inFlight) return;
    this.committed = true;
    this.runInference();
  }

  cancel(): void {
    this.canceled = true;
    this.chunks = [];
    this.sampleCount = 0;
    this.committed = false;
    this.generation++;
    applyCrispAsrRetentionPolicy();
  }

  close(): void {
    this.closed = true;
    this.cancel();
    applyCrispAsrRetentionPolicy();
  }

  private startLoad(): void {
    if (getCrispModelStatus(this.opts.modelId)?.status !== "ready") {
      this.readyPromise = Promise.reject(
        new Error("CrispASR model is not downloaded yet."),
      );
      this.readyPromise.catch(() => undefined);
      this.opts.callbacks.onError("CrispASR model is not downloaded yet.");
      return;
    }

    const generation = this.generation;
    this.readyPromise = ensureCrispServerRunning(this.opts.modelId).then(() => {
      if (this.closed || this.canceled || generation !== this.generation) {
        return;
      }
      this.opts.callbacks.onReady(this.opts.modelId);
    });

    this.readyPromise.catch((err: Error) => {
      if (this.closed || generation !== this.generation) return;
      this.opts.callbacks.onError(err.message);
    });
  }

  private runInference(): void {
    if (this.closed || this.canceled || this.inFlight) return;

    if (this.sampleCount === 0) {
      this.opts.callbacks.onFinal("");
      return;
    }
    if (getCrispModelStatus(this.opts.modelId)?.status !== "ready") {
      this.opts.callbacks.onError("CrispASR model is not downloaded yet.");
      return;
    }

    const generation = this.generation;
    const audio = Buffer.concat(this.chunks);
    this.inFlight = true;

    void this.readyPromise
      .then(() => {
        if (this.closed || this.canceled || generation !== this.generation) {
          return;
        }
        return transcribePcmWithCrispAsr({
          modelId: this.opts.modelId,
          pcm: new Uint8Array(audio),
          sampleRate: STREAM_SAMPLE_RATE,
          language: this.opts.language,
          context: this.opts.context,
          deferUnload: true,
        });
      })
      .then((text) => {
        if (text === undefined) return;
        if (this.closed || this.canceled || generation !== this.generation) {
          return;
        }
        this.opts.callbacks.onFinal(text.trim());
        applyCrispAsrRetentionPolicy();
      })
      .catch((err: Error) => {
        if (this.closed || generation !== this.generation) return;
        this.opts.callbacks.onError(err.message);
      })
      .finally(() => {
        if (this.closed || this.canceled || generation !== this.generation) {
          if (this.closed || this.canceled) {
            applyCrispAsrRetentionPolicy();
          }
          return;
        }
        this.inFlight = false;
      });
  }
}
