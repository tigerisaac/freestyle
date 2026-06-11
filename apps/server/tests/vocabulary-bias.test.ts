import { describe, expect, it } from "vitest";
import { sonioxContextFromBias } from "../src/lib/streaming/transcribe-bias.js";
import { buildAsrVocabularyBias } from "../src/lib/vocabulary-bias.js";

describe("buildAsrVocabularyBias (soniox)", () => {
  it("maps vocabulary terms to soniox-context", () => {
    const bias = buildAsrVocabularyBias(
      "soniox",
      "soniox/stt-rt-v4",
      ["Freestyle", "Kubernetes"],
      undefined,
      true,
    );
    expect(bias).toEqual({
      kind: "soniox-context",
      terms: ["Freestyle", "Kubernetes"],
    });
  });

  it("includes transcription prompt as context text", () => {
    const bias = buildAsrVocabularyBias(
      "soniox",
      "soniox/stt-rt-v4",
      ["Acme Corp"],
      "Medical dictation about diabetes care.",
      true,
    );
    expect(bias).toEqual({
      kind: "soniox-context",
      terms: ["Acme Corp"],
      text: "Medical dictation about diabetes care.",
    });
  });

  it("returns null when there is nothing to send", () => {
    expect(
      buildAsrVocabularyBias("soniox", "soniox/stt-rt-v4", [], undefined, true),
    ).toBeNull();
  });
});

describe("sonioxContextFromBias", () => {
  it("builds Soniox WebSocket context object", () => {
    expect(
      sonioxContextFromBias({
        kind: "soniox-context",
        terms: ["Celebrex", "Xanax"],
        text: "Healthcare call.",
      }),
    ).toEqual({
      terms: ["Celebrex", "Xanax"],
      text: "Healthcare call.",
    });
  });

  it("ignores non-soniox bias kinds", () => {
    expect(
      sonioxContextFromBias({ kind: "prompt", text: "Terms: foo." }),
    ).toBeUndefined();
  });
});
