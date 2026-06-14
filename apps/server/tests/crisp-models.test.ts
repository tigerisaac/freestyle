import { describe, expect, it } from "vitest";
import { CRISP_ASR_MODELS } from "../src/lib/crisp-asr/constants.js";

describe("CrispASR model catalog", () => {
  it("includes qwen3 0.6b 8-bit for Windows and Linux local ASR", () => {
    const model = CRISP_ASR_MODELS.find(
      (entry) => entry.id === "qwen3-0.6b-8bit",
    );

    expect(model).toMatchObject({
      fileName: "qwen3-asr-0.6b-q8_0.gguf",
      family: "qwen3-asr",
      displayName: "Qwen3 Fast",
      quantized: true,
    });
  });
});
