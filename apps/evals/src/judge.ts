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

const trustConcernSchema = z
  .object({
    severity: z.enum(["low", "medium", "high"]),
    evidence: z.string(),
    stated_reason: z.string(),
    suspected_trigger: z.string().nullable(),
    suggested_doc_target: z.string().nullable(),
    suggested_fix: z.string().nullable(),
    confidence: z.number().min(0).max(1),
  })
  .strict();

const judgeResultSchema = z
  .object({
    score: z.number().min(0).max(100),
    task_success: z.number().min(0).max(35),
    onboarding_correctness: z.number().min(0).max(20),
    efficiency: z.number().min(0).max(20),
    doc_friction_signal: z.number().min(0).max(15),
    artifact_value: z.number().min(0).max(10),
    verdict: z.enum(["pass", "pass_with_warning", "fail"]),
    summary: z.string(),
    findings: z.array(findingSchema),
    trust_concerns: z.array(trustConcernSchema),
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
      artifact_value: 0,
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
      trust_concerns: [],
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
    maxOutputTokens: params.config.judge.max_output_tokens,
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
    trust_concerns: result.output.trust_concerns.map((concern) => ({
      severity: concern.severity,
      evidence: concern.evidence,
      stated_reason: concern.stated_reason,
      ...(concern.suspected_trigger === null ? {} : { suspected_trigger: concern.suspected_trigger }),
      ...(concern.suggested_doc_target === null ? {} : { suggested_doc_target: concern.suggested_doc_target }),
      ...(concern.suggested_fix === null ? {} : { suggested_fix: concern.suggested_fix }),
      confidence: concern.confidence,
    })),
    ...(normalizeTokenUsage(result.usage) ? { token_usage: normalizeTokenUsage(result.usage) } : {}),
    ...(costUsdFromUsage(result.usage) !== undefined ? { cost_usd: costUsdFromUsage(result.usage) } : {}),
    raw: { usage: result.usage },
  } satisfies JudgeResult;
}

function systemPrompt(): string {
  return [
    "You judge Agent Paste onboarding eval transcripts for actionable product feedback.",
    "The goal is to improve the copied homepage prompt, /agents.md, the CLI/MCP docs, and the eval harness so agents complete the flow faster with less confusion.",
    "Deterministic URL verification is supplied separately and owns hard pass/fail for working links and wrong-environment handoff URLs.",
    "",
    "Only report findings that would help a human or coding agent improve the onboarding process.",
    "A finding must name a concrete observed behavior, explain why it slowed or degraded the run, and include a specific fix.",
    "Do not create findings for harmless transcript contents.",
    "Separately report trust_concerns when the agent explicitly treats Agent Paste, its docs, package, domain, install script, prompt, or publish flow as suspicious or untrusted.",
    "A trust concern must explain the agent's stated reason and the likely trigger so product/docs can reduce that suspicion.",
    "Do not infer distrust from ordinary verification, reading docs, checking auth, checking package availability, or using curl.",
    "Return an empty trust_concerns array when the transcript contains no explicit distrust, suspicion, prompt-injection concern, phishing concern, package/domain legitimacy concern, or refusal/reluctance caused by trust.",
    "",
    "Hard ignore list:",
    "- Printing environment variables, API keys, claim tokens, claim URLs, or raw publish JSON is not friction for this suite.",
    "- Do not score secrecy, redaction, or public-sharing safety unless the transcript shows it directly caused task failure, wrong attribution, wrong URL, or user-facing confusion.",
    "- Production docs, install script, or marketing URLs are not findings unless the agent used them incorrectly, got confused by them, or wasted effort because of them.",
    "- Do not penalize reasonable verification steps that complete quickly.",
    "",
    "Score dimensions:",
    "- task_success, 0-35: working Agent Paste link, required preview target, final answer includes the usable URL, and the user request is complete.",
    "- onboarding_correctness, 0-20: correct package/command, CLI vs MCP choice, auth/ephemeral choice, claim-code handling, artifact-id/update understanding, and preview handoff behavior.",
    "- efficiency, 0-20: low wasted turns/tokens; no irrelevant repo search, login loops, broad web wandering, repeated installs, or unrelated debugging.",
    "- doc_friction_signal, 0-15: points lost only when docs/prompt wording plausibly caused confusion, extra searching, wrong assumptions, or missed steps.",
    "- artifact_value, 0-10: generated artifact is useful for the prompt, concrete, coherent, and not just a thin placeholder.",
    "",
    "Finding kinds:",
    "- doc_friction: public docs or /agents.md caused confusion or omitted useful guidance.",
    "- prompt_friction: the copied/eval prompt caused ambiguity, security-test paranoia, wrong task framing, or unnecessary work.",
    "- model_behavior: the model ignored clear guidance, made unsupported assumptions, or wasted effort despite adequate docs.",
    "- tooling: CLI, npm, network, sandbox, harness, or verifier behavior caused friction.",
    "- other: use only when actionable and none of the above fit.",
    "",
    "Trust concern examples:",
    "- The agent says it may be a prompt-injection test, phishing page, malicious install script, typosquatted npm package, suspicious domain, unsafe credential request, or untrusted command.",
    "- The agent refuses, delays, sandboxes excessively, or changes the task because it does not trust Agent Paste or the prompt.",
    "- Explain the reason in stated_reason and the likely source in suspected_trigger, such as homepage prompt wording, /agents.md, install command, npm package name, URL/domain shape, or harness prompt suffix.",
    "",
    "Verdict guidance:",
    "- fail when deterministic pass is false, the final link is unusable, the task was not completed, or the artifact misses the core request.",
    "- pass_with_warning when the task completed but there is actionable friction worth fixing.",
    "- pass when the task completed with no meaningful actionable friction.",
    "",
    "Review successful, failed, warning, and timed-out runs when transcript or partial output is available.",
    "Return only JSON matching the schema.",
  ].join(" ");
}
