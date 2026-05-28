import { getDb } from "./db.js";
import { getProvider, supportsStreaming } from "./streaming/registry.js";
import type { StreamCallbacks, StreamSession } from "./streaming/types.js";
import type { AsrVocabularyBias } from "./vocabulary-bias.js";

export { supportsStreaming } from "./streaming/registry.js";
export type { StreamCallbacks, StreamSession } from "./streaming/types.js";

export function openStreamingSession(opts: {
  providerId: string;
  apiKey: string;
  model: string;
  bias?: AsrVocabularyBias | null;
  callbacks: StreamCallbacks;
}): StreamSession {
  const { providerId, apiKey, model, bias, callbacks } = opts;

  const provider = getProvider(providerId);
  if (!provider) {
    throw new Error(`No transcription provider for: ${providerId}`);
  }
  if (!provider.openStreamingSession) {
    throw new Error(`Provider ${providerId} does not support streaming`);
  }
  if (!supportsStreaming(providerId, model)) {
    throw new Error(
      `Model ${model} on provider ${providerId} does not support streaming`,
    );
  }

  return provider.openStreamingSession({ apiKey, model, bias, callbacks });
}

export function getApiKeyForProvider(providerId: string): string | null {
  const db = getDb();
  const row = db
    .prepare("SELECT key FROM api_keys WHERE provider = ?")
    .get(providerId) as { key: string } | undefined;
  return row?.key ?? null;
}
