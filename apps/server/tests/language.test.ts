import { describe, expect, it } from "vitest";
import {
  normalizeLanguageHintsSetting,
  normalizeLanguageSetting,
  parseLanguageSetting,
} from "../src/lib/language.js";
import { resolveMlxLanguage } from "../src/lib/mlx-asr/language.js";
import { createPcmUpsampler } from "../src/lib/streaming/pcm.js";
import { buildSonioxSessionConfig } from "../src/lib/streaming/providers/soniox.js";
import { aiSdkProviderOptions } from "../src/lib/streaming/utils.js";

describe("parseLanguageSetting", () => {
  it("splits comma-separated language hints", () => {
    expect(parseLanguageSetting("en,es,fr")).toEqual(["en", "es", "fr"]);
  });

  it("trims entries and drops duplicates", () => {
    expect(parseLanguageSetting(" en, es ,en ,, fr ")).toEqual([
      "en",
      "es",
      "fr",
    ]);
  });

  it("returns an empty list for auto and missing values", () => {
    expect(parseLanguageSetting("auto")).toEqual([]);
    expect(parseLanguageSetting("")).toEqual([]);
    expect(parseLanguageSetting(null)).toEqual([]);
    expect(parseLanguageSetting(undefined)).toEqual([]);
  });
});

describe("normalizeLanguageSetting", () => {
  it("passes ISO codes through", () => {
    expect(normalizeLanguageSetting("en")).toBe("en");
    expect(normalizeLanguageSetting("uk")).toBe("uk");
  });

  it("omits the cleanup language when multiple hints are selected", () => {
    expect(normalizeLanguageSetting("en,es")).toBeUndefined();
  });

  it("normalizes auto, empty, and missing values to undefined", () => {
    expect(normalizeLanguageSetting("auto")).toBeUndefined();
    expect(normalizeLanguageSetting("")).toBeUndefined();
    expect(normalizeLanguageSetting(null)).toBeUndefined();
    expect(normalizeLanguageSetting(undefined)).toBeUndefined();
  });
});

describe("normalizeLanguageHintsSetting", () => {
  it("returns every configured language hint", () => {
    expect(normalizeLanguageHintsSetting("en,es")).toEqual(["en", "es"]);
  });

  it("returns undefined for auto and missing values", () => {
    expect(normalizeLanguageHintsSetting("auto")).toBeUndefined();
    expect(normalizeLanguageHintsSetting("")).toBeUndefined();
    expect(normalizeLanguageHintsSetting(null)).toBeUndefined();
    expect(normalizeLanguageHintsSetting(undefined)).toBeUndefined();
  });
});

describe("buildSonioxSessionConfig", () => {
  it("sends multiple language hints as separate entries", () => {
    expect(
      buildSonioxSessionConfig({
        apiKey: "test",
        model: "soniox/stt-rt-v4",
        languageHints: ["en", "es"],
      }),
    ).toMatchObject({
      language_hints: ["en", "es"],
    });
  });

  it("falls back to the single language hint when no list is provided", () => {
    expect(
      buildSonioxSessionConfig({
        apiKey: "test",
        model: "soniox/stt-rt-v4",
        language: "fr",
      }),
    ).toMatchObject({
      language_hints: ["fr"],
    });
  });
});

describe("aiSdkProviderOptions", () => {
  it("sends language for openai", () => {
    expect(aiSdkProviderOptions("openai", "es", null)).toEqual({
      openai: { language: "es" },
    });
  });

  it("sends language for groq", () => {
    expect(aiSdkProviderOptions("groq", "fr", null)).toEqual({
      groq: { language: "fr" },
    });
  });

  it("sends languageCode for elevenlabs", () => {
    expect(aiSdkProviderOptions("elevenlabs", "de", null)).toEqual({
      elevenlabs: { languageCode: "de" },
    });
  });

  it("merges language with prompt bias", () => {
    expect(
      aiSdkProviderOptions("openai", "en", {
        kind: "prompt",
        text: "Terms: Freestyle.",
      }),
    ).toEqual({
      openai: { prompt: "Terms: Freestyle.", language: "en" },
    });
  });

  it("returns bias options alone when language is unset", () => {
    expect(
      aiSdkProviderOptions("groq", undefined, {
        kind: "prompt",
        text: "Terms: Freestyle.",
      }),
    ).toEqual({
      groq: { prompt: "Terms: Freestyle." },
    });
  });

  it("returns undefined when there is nothing to send", () => {
    expect(aiSdkProviderOptions("openai", undefined, null)).toBeUndefined();
    expect(aiSdkProviderOptions("openai", "auto", null)).toBeUndefined();
  });
});

describe("resolveMlxLanguage", () => {
  it("maps ISO codes to Qwen3 language names", () => {
    expect(resolveMlxLanguage("qwen3-0.6b-8bit", "en")).toBe("English");
    expect(resolveMlxLanguage("qwen3-1.7b-8bit", "zh")).toBe("Chinese");
    expect(resolveMlxLanguage("qwen3-0.6b-8bit", "sv")).toBe("Swedish");
  });

  it("drops languages Qwen3 does not support", () => {
    expect(resolveMlxLanguage("qwen3-0.6b-8bit", "uk")).toBeUndefined();
    expect(resolveMlxLanguage("qwen3-0.6b-8bit", "no")).toBeUndefined();
  });

  it("drops auto and missing values", () => {
    expect(resolveMlxLanguage("qwen3-0.6b-8bit", "auto")).toBeUndefined();
    expect(resolveMlxLanguage("qwen3-0.6b-8bit", undefined)).toBeUndefined();
  });

  it("passes ISO codes through for non-qwen3 models", () => {
    expect(resolveMlxLanguage("parakeet-tdt-0.6b-v3", "fr")).toBe("fr");
    expect(resolveMlxLanguage("parakeet-tdt-0.6b-v3", "auto")).toBeUndefined();
  });
});

describe("createPcmUpsampler", () => {
  function toInt16(samples: number[]): ArrayBuffer {
    return new Int16Array(samples).buffer;
  }

  it("returns input unchanged when rates match", () => {
    const upsample = createPcmUpsampler(16_000, 16_000);
    const chunk = toInt16([1, 2, 3]);
    expect(upsample(chunk)).toBe(chunk);
  });

  it("produces 3 output samples per 2 input samples at 16k to 24k", () => {
    const upsample = createPcmUpsampler(16_000, 24_000);
    let outSamples = 0;
    let inSamples = 0;
    for (let i = 0; i < 100; i++) {
      const chunk = new Int16Array(320).fill(1000);
      inSamples += chunk.length;
      outSamples += new Int16Array(upsample(chunk.buffer)).length;
    }
    expect(outSamples / inSamples).toBeCloseTo(1.5, 2);
  });

  it("interpolates linearly between samples", () => {
    const upsample = createPcmUpsampler(16_000, 24_000);
    const out = new Int16Array(upsample(toInt16([0, 300, 600, 900])));
    expect(Array.from(out)).toEqual([0, 200, 400, 600, 800]);
  });

  it("interpolates continuously across chunk boundaries", () => {
    const upsample = createPcmUpsampler(16_000, 24_000);
    const first = Array.from(new Int16Array(upsample(toInt16([0, 300]))));
    const second = Array.from(new Int16Array(upsample(toInt16([600, 900]))));
    expect([...first, ...second]).toEqual([0, 200, 400, 600, 800]);
  });

  it("preserves a constant signal", () => {
    const upsample = createPcmUpsampler(16_000, 24_000);
    const out = new Int16Array(upsample(new Int16Array(160).fill(-512).buffer));
    expect(out.every((s) => s === -512)).toBe(true);
  });

  it("handles empty chunks", () => {
    const upsample = createPcmUpsampler(16_000, 24_000);
    expect(new Int16Array(upsample(new ArrayBuffer(0))).length).toBe(0);
  });
});
