import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, type LanguageModel } from "ai";
import { maxOutputTokensForCleanup } from "../src/lib/editor/max-output-tokens.ts";
import { sanitizeTranscriptText } from "../src/lib/editor/model-hints.ts";
import {
  buildRewritePrompt,
  type EditMode,
} from "../src/lib/editor/prompts.ts";
import {
  EDIT_MODE_BENCHMARK_CASES,
  type EditModeBenchmarkCase,
} from "./edit-mode-benchmark-cases.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

type Mode = "strict" | "default" | "extra";

interface CaseResult {
  mode: Mode;
  caseId: string;
  category: string;
  input: string;
  output: string;
  score: number;
  reasoning: string;
  error?: string;
}

interface IterationResult {
  iteration: number;
  results: CaseResult[];
}

// ─── Mode metadata ────────────────────────────────────────────────────────────

const MODE_META: Record<
  Mode,
  { name: string; description: string; criteria: string }
> = {
  strict: {
    name: "STRICT",
    description: "Minimal edits — only fix transcription artifacts",
    criteria: `STRICT mode criteria:
- Output only removed filler words (um, uh, you know, etc.) and stutters
- Output only added basic punctuation and capitalization
- Output only resolved explicit self-corrections (wait no, actually no, etc.)
- Output did NOT reformat into lists or structured formats — kept original prose flow
- Output did NOT change word choices, tone, register, or formality
- Output did NOT restructure or rephrase sentences
- Output preserved all qualifiers, hedges, greetings, and lead-ins
- Output preserved colloquialisms and contractions exactly as spoken`,
  },
  default: {
    name: "DEFAULT",
    description:
      "Small edits — fillers, punctuation, corrections, list formatting when dictated",
    criteria: `DEFAULT mode criteria:
- Output removed filler words, stutters, and accidental repetitions
- Output added appropriate punctuation, capitalization, spacing
- Output resolved self-corrections and backtracking correctly
- Output formatted lists when the transcript clearly dictated them (numbered for ordered, bullets for unordered)
- Output preserved colloquialisms unless a formal register hint was present
- Output did NOT over-edit — kept original wording, tone, and structure where reasonable
- Output did NOT change meaning or add content
- Output was restrained; preferred under-editing to over-polishing`,
  },
  extra: {
    name: "EXTRA",
    description:
      "Polished prose — restructure, refine, improve flow while preserving meaning",
    criteria: `EXTRA mode criteria:
- Output removed filler words, stutters, and verbal tics
- Output resolved self-corrections correctly
- Output improved sentence structure and flow — restructured awkward phrasing, broke up or combined sentences for natural rhythm
- Output refined word choices for clarity and naturalness where appropriate
- Output formatted lists appropriately when dictated
- Output reads like well-edited prose, not raw transcript
- Output preserved the speaker's core meaning, facts, decisions, and intent
- Output did NOT change meaning, add content, or make it sound like bland AI-generated text
- Output should be more polished than default mode but not excessively rewritten`,
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseCsvArg(name: string): string[] | null {
  const arg = process.argv.find((entry) => entry.startsWith(`--${name}=`));
  if (!arg) return null;
  return (
    arg
      .split("=")[1]
      ?.split(",")
      .map((v) => v.trim())
      .filter(Boolean) ?? null
  );
}

function parseStringArg(name: string): string | undefined {
  const arg = process.argv.find((entry) => entry.startsWith(`--${name}=`));
  return arg?.split("=")[1]?.trim() || undefined;
}

function parseIntArg(name: string, fallback: number): number {
  const raw = parseStringArg(name);
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries = 3,
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isRateLimit =
        message.includes("429") ||
        message.includes("rate") ||
        message.includes("too many");
      if (attempt < maxRetries && isRateLimit) {
        const delay = attempt * 5000;
        console.error(
          `  Rate limit on ${label}, retrying in ${delay / 1000}s (attempt ${attempt}/${maxRetries})...`,
        );
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Retry exhausted for ${label}`);
}

// ─── DeepSeek evaluator ──────────────────────────────────────────────────────

function getDeepSeekModel(): LanguageModel {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error(
      "DEEPSEEK_API_KEY environment variable is not set. Required for evaluation.",
    );
  }

  const deepseek = createOpenAI({
    baseURL: "https://api.deepseek.com/v1",
    apiKey,
  });

  return deepseek.chat("deepseek-chat");
}

function buildEvaluatorPrompt(
  mode: Mode,
  systemPrompt: string,
  inputTranscript: string,
  modelOutput: string,
): string {
  const meta = MODE_META[mode];

  return `You are an evaluator scoring the quality of a transcript editing model's output.

CONTEXT:
The LLM was given the following system prompt (editing instructions):
--- SYSTEM PROMPT ---
${systemPrompt}
--- END SYSTEM PROMPT ---

The editing mode is: ${meta.name} (${meta.description})

SCORING CRITERIA for ${meta.name} mode:
${meta.criteria}

ORIGINAL TRANSCRIPT:
${inputTranscript}

MODEL'S EDITED OUTPUT:
${modelOutput}

Score the output on this scale:
- 1: Full pass — the output perfectly follows the editing instructions for this mode
- 0.3: Partial pass — mostly correct but has one or two minor issues
- 0: Fail — significantly violates the editing instructions (over-edits, under-edits, changes meaning, etc.)

Return your evaluation as JSON only:
{"score": <0|0.3|1>, "reasoning": "<brief explanation of what was good and what was wrong>"}`;
}

function parseEvaluatorResponse(text: string): {
  score: number;
  reasoning: string;
} {
  // Try to extract JSON from the response
  const cleaned = text.trim();

  // Handle markdown code fences
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const raw = fenceMatch ? fenceMatch[1]!.trim() : cleaned;

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      score: 0,
      reasoning: `Failed to parse evaluator response: ${cleaned.slice(0, 200)}`,
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      score?: number;
      reasoning?: string;
    };
    const score = typeof parsed.score === "number" ? parsed.score : 0;
    return {
      score: Math.max(0, Math.min(1, score)),
      reasoning: String(parsed.reasoning ?? "No reasoning provided"),
    };
  } catch {
    return {
      score: 0,
      reasoning: `Failed to parse JSON from: ${jsonMatch[0].slice(0, 200)}`,
    };
  }
}

// ─── Model calling ────────────────────────────────────────────────────────────

let _groqModel: LanguageModel | null = null;

function getGroqModel(): LanguageModel {
  if (_groqModel) return _groqModel;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY not set");
  const groq = createGroq({ apiKey });
  _groqModel = groq.languageModel("llama-3.1-8b-instant");
  return _groqModel;
}

async function runEditModel(
  mode: Mode,
  testCase: EditModeBenchmarkCase,
): Promise<{ output: string; systemPrompt: string }> {
  const model = getGroqModel();
  const { system, prompt } = buildRewritePrompt(testCase.input, {
    editMode: mode,
  });

  return withRetry(async () => {
    const result = await generateText({
      model,
      system,
      prompt,
      temperature: 0,
      maxOutputTokens: maxOutputTokensForCleanup(testCase.input),
    });

    const sanitized = sanitizeTranscriptText(result.text);
    return { output: sanitized, systemPrompt: system };
  }, `Groq edit ${mode}/${testCase.id}`);
}

async function evaluateOutput(
  mode: Mode,
  systemPrompt: string,
  testCase: EditModeBenchmarkCase,
  modelOutput: string,
): Promise<{ score: number; reasoning: string }> {
  const evaluator = getDeepSeekModel();
  const prompt = buildEvaluatorPrompt(
    mode,
    systemPrompt,
    testCase.input,
    modelOutput,
  );

  return withRetry(async () => {
    const result = await generateText({
      model: evaluator,
      prompt,
      temperature: 0,
      maxOutputTokens: 2048,
    });
    return parseEvaluatorResponse(result.text);
  }, `DeepSeek eval ${mode}/${testCase.id}`);
}

// ─── Run single case ─────────────────────────────────────────────────────────

async function runSingleCase(
  mode: Mode,
  testCase: EditModeBenchmarkCase,
  iteration: number,
): Promise<CaseResult> {
  const caseId = testCase.id;

  try {
    const { output, systemPrompt } = await runEditModel(mode, testCase);
    const { score, reasoning } = await evaluateOutput(
      mode,
      systemPrompt,
      testCase,
      output,
    );

    return {
      mode,
      caseId,
      category: testCase.category,
      input: testCase.input,
      output,
      score,
      reasoning,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[iter ${iteration}] ERROR ${mode}/${caseId}: ${message}`);
    return {
      mode,
      caseId,
      category: testCase.category,
      input: testCase.input,
      output: "",
      score: 0,
      reasoning: `Error: ${message}`,
      error: message,
    };
  }
}

// ─── Output formatting ───────────────────────────────────────────────────────

function padRight(str: string, len: number): string {
  return str.length >= len ? str : str + " ".repeat(len - str.length);
}

function printCaseTable(results: CaseResult[]): void {
  const modes = ["strict", "default", "extra"] as const;

  // Header
  const caseColWidth = 30;
  const scoreColWidth = 8;

  console.log(
    `\n${padRight("Case", caseColWidth)} ${modes.map((m) => padRight(m.toUpperCase(), scoreColWidth)).join(" ")}  Reasoning`,
  );
  console.log(
    "-".repeat(caseColWidth + modes.length * (scoreColWidth + 1) + 40),
  );

  // Group by caseId
  const byCase = new Map<string, CaseResult[]>();
  for (const r of results) {
    const list = byCase.get(r.caseId) ?? [];
    list.push(r);
    byCase.set(r.caseId, list);
  }

  for (const [caseId, caseResults] of byCase) {
    const label = caseResults[0]?.category ?? caseId;
    const labelStr = `${label} (${caseId})`.slice(0, caseColWidth - 1);
    const scores = modes.map((m) => {
      const cr = caseResults.find((r) => r.mode === m);
      if (!cr) return padRight("-", scoreColWidth);
      const display = cr.error ? "ERR" : cr.score.toFixed(1);
      return padRight(display, scoreColWidth);
    });

    const firstReasoning = caseResults[0]?.reasoning ?? "";
    const shortReasoning =
      firstReasoning.length > 50
        ? firstReasoning.slice(0, 47) + "..."
        : firstReasoning;

    console.log(
      `${padRight(labelStr, caseColWidth)} ${scores.join(" ")}  ${shortReasoning}`,
    );

    // Print detailed per-mode output for non-trivial cases
    for (const cr of caseResults) {
      if (cr.error) {
        console.log(`  [${cr.mode}] ERROR: ${cr.error}`);
      } else if (cr.score < 1) {
        console.log(
          `  [${cr.mode}] score=${cr.score} → "${cr.output.slice(0, 80)}${cr.output.length > 80 ? "..." : ""}"`,
        );
        console.log(`           ${cr.reasoning.slice(0, 120)}`);
      }
    }
  }
}

function printAggregates(results: CaseResult[]): void {
  const modes = ["strict", "default", "extra"] as const;

  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║              AGGREGATE SCORES               ║");
  console.log("╠════════════╤══════════╤══════════╤══════════╣");
  console.log("║   Mode     │ Avg Score│ Pass Rate│  # Cases ║");
  console.log("╟────────────┼──────────┼──────────┼──────────╢");

  for (const mode of modes) {
    const modeResults = results.filter((r) => r.mode === mode);
    if (modeResults.length === 0) continue;

    const total = modeResults.length;
    const sumScore = modeResults.reduce((acc, r) => acc + r.score, 0);
    const avgScore = sumScore / total;
    const passCount = modeResults.filter((r) => r.score >= 0.7).length;
    const passRate = ((passCount / total) * 100).toFixed(1) + "%";

    console.log(
      `║ ${padRight(mode.toUpperCase(), 10)} │ ${String(avgScore.toFixed(2)).padStart(8)} │ ${passRate.padStart(8)} │ ${String(total).padStart(8)} ║`,
    );
  }

  console.log("╚════════════╧══════════╧══════════╧══════════╝");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const modeArg = parseStringArg("mode") ?? "all";
  const selectedCasesArg = parseCsvArg("cases");
  const iterations = parseIntArg("iterations", 1);

  const modes: Mode[] =
    modeArg === "all"
      ? ["strict", "default", "extra"]
      : modeArg
          .split(",")
          .filter((m): m is Mode => ["strict", "default", "extra"].includes(m));

  if (modes.length === 0) {
    console.error(
      `Invalid mode: "${modeArg}". Must be one of: strict, default, extra, all`,
    );
    process.exit(1);
  }

  const selectedCases = selectedCasesArg
    ? EDIT_MODE_BENCHMARK_CASES.filter((c) => selectedCasesArg.includes(c.id))
    : EDIT_MODE_BENCHMARK_CASES;

  if (selectedCases.length === 0) {
    console.error("No benchmark cases selected.");
    process.exit(1);
  }

  // Validate API keys
  if (!process.env.GROQ_API_KEY) {
    console.error("ERROR: GROQ_API_KEY environment variable is not set.");
    process.exit(1);
  }
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error("ERROR: DEEPSEEK_API_KEY environment variable is not set.");
    process.exit(1);
  }

  console.log(`Edit Mode Evaluation`);
  console.log(`Modes: ${modes.join(", ")}`);
  console.log(
    `Cases: ${selectedCases.length} (${selectedCases.map((c) => c.id).join(", ")})`,
  );
  console.log(`Iterations: ${iterations}`);
  console.log("");

  const allIterationResults: IterationResult[] = [];

  for (let iter = 1; iter <= iterations; iter++) {
    if (iterations > 1) {
      console.log(`\n━━━ ITERATION ${iter}/${iterations} ━━━`);
    }

    const results: CaseResult[] = [];

    // Shuffle interleaving: for each case, run all 3 modes before next case
    for (const testCase of selectedCases) {
      // Run modes sequentially for the same case to avoid rate limiting
      for (const mode of modes) {
        console.log(
          `[iter ${iter}] Running ${mode}/${testCase.id} (${testCase.category})...`,
        );
        const result = await runSingleCase(mode, testCase, iter);
        results.push(result);

        // Pause between calls to stay within Groq rate limits (30 RPM / 6k TPM)
        await sleep(3000);
      }
    }

    allIterationResults.push({ iteration: iter, results });

    if (iterations === 1 || iter === iterations) {
      printCaseTable(results);
      printAggregates(results);
    } else {
      // Print intermediate summary
      console.log(`\n--- Iteration ${iter} Summary ---`);
      printAggregates(results);
    }
  }

  // If multiple iterations, print overall averages
  if (iterations > 1) {
    console.log(`\n\n═══════ OVERALL (${iterations} iterations) ═══════`);

    // Merge all results for aggregate
    const allResults = allIterationResults.flatMap((ir) => ir.results);

    console.log(`\nTotal evaluations: ${allResults.length}`);

    printAggregates(allResults);

    // Per-iteration trend
    console.log(`\n--- Iteration Trends ---`);
    console.log(
      `Iter  ${padRight("strict", 6)}  ${padRight("default", 6)}  ${padRight("extra", 6)}`,
    );
    console.log("-".repeat(50));

    for (const ir of allIterationResults) {
      const modeAvgs = ["strict", "default", "extra"].map((m) => {
        const modeResults = ir.results.filter((r) => r.mode === m);
        if (modeResults.length === 0) return "N/A";
        const avg =
          modeResults.reduce((acc, r) => acc + r.score, 0) / modeResults.length;
        return avg.toFixed(2);
      });
      console.log(
        `  ${String(ir.iteration).padStart(3)}  ${modeAvgs.map((a) => padRight(a, 6)).join("  ")}`,
      );
    }
  }
}

void main().catch((err) => {
  console.error(
    "Fatal error:",
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
});
