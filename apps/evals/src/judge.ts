import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, Output } from "ai";
import { z } from "zod";
import { costUsdFromUsage, normalizeTokenUsage } from "./metrics";
import type { EvalConfig, JudgeResult, RunResult } from "./types";

const findingSchema = z
  .object({
    kind: z.enum(["doc_friction", "prompt_friction", "model_behavior", "tooling", "other"]),
    severity: z.enum(["low", "medium", "high"]),
    evidence: z.string(),
    wasted_turns: z.number().nullable(),
    estimated_wasted_tokens: z.number().nullable(),
    suggested_doc_target: z.string().nullable(),
    suggested_fix: z.string().nullable(),
    confidence: z.number().min(0).max(1),
  })
  .strict();

const judgeResultSchema = z
  .object({
    score: z.number().min(0).max(100),
    task_success: z.number().min(0).max(40),
    onboarding_correctness: z.number().min(0).max(20),
    efficiency: z.number().min(0).max(20),
    doc_friction_signal: z.number().min(0).max(15),
    safety_public_sharing: z.number().min(0).max(5),
    verdict: z.enum(["pass", "pass_with_warning", "fail"]),
    summary: z.string(),
    findings: z.array(findingSchema),
  })
  .strict();

export async function judgeRun(params: {
  config: EvalConfig;
  apiKey: string;
  result: RunResult;
  transcript: string;
}): Promise<JudgeResult> {
  const transcript =
    params.transcript.length > params.config.judge.max_transcript_chars
      ? params.transcript.slice(0, params.config.judge.max_transcript_chars)
      : params.transcript;

  if (
    params.transcript.length > params.config.judge.max_transcript_chars &&
    params.config.judge.oversized_transcript === "fail"
  ) {
    return {
      score: 0,
      task_success: 0,
      onboarding_correctness: 0,
      efficiency: 0,
      doc_friction_signal: 0,
      safety_public_sharing: 0,
      verdict: "fail",
      summary: "Transcript exceeded judge budget for the short-loop suite.",
      findings: [
        {
          kind: "model_behavior",
          severity: "high",
          evidence: "Transcript exceeded configured max_transcript_chars.",
          confidence: 1,
        },
      ],
    };
  }

  const openrouter = createOpenRouter({
    apiKey: params.apiKey,
    appName: "Agent Paste evals",
    appUrl: "https://agent-paste.sh",
  });
  const result = await generateText({
    model: openrouter(params.config.judge.model),
    system: systemPrompt(),
    prompt: JSON.stringify(
      {
        rubric_version: params.config.judge.rubric_version,
        run_status: params.result.status,
        model_id: params.result.model_id,
        harness_id: params.result.harness_id,
        failures: params.result.failures,
        warnings: params.result.warnings,
        suite: {
          id: params.config.suite.id,
          description: params.config.suite.description,
        },
        prompt_under_test: params.result.prompt,
        verifier: params.result.verifier,
        deterministic_pass: params.result.deterministic_pass,
        final_answer: params.result.final_answer,
        transcript,
      },
      null,
      2,
    ),
    output: Output.object({ schema: judgeResultSchema }),
  });
  return {
    ...result.output,
    findings: result.output.findings.map((finding) => ({
      kind: finding.kind,
      severity: finding.severity,
      evidence: finding.evidence,
      ...(finding.wasted_turns === null ? {} : { wasted_turns: finding.wasted_turns }),
      ...(finding.estimated_wasted_tokens === null ? {} : { estimated_wasted_tokens: finding.estimated_wasted_tokens }),
      ...(finding.suggested_doc_target === null ? {} : { suggested_doc_target: finding.suggested_doc_target }),
      ...(finding.suggested_fix === null ? {} : { suggested_fix: finding.suggested_fix }),
      confidence: finding.confidence,
    })),
    ...(normalizeTokenUsage(result.usage) ? { token_usage: normalizeTokenUsage(result.usage) } : {}),
    ...(costUsdFromUsage(result.usage) !== undefined ? { cost_usd: costUsdFromUsage(result.usage) } : {}),
    raw: { usage: result.usage },
  } satisfies JudgeResult;
}

function systemPrompt(): string {
  return [
    "You judge Agent Paste onboarding eval transcripts.",
    "Deterministic URL verification is supplied separately and owns hard pass/fail.",
    "Review successful, failed, warning, and timed-out runs when transcript or partial output is available.",
    "Score process quality, wasted effort, and doc friction.",
    "Return only JSON matching the schema.",
  ].join(" ");
}
