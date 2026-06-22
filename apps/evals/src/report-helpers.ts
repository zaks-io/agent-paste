export function failureSuggestedFix(failure: string): string | undefined {
  if (failure === "missing_final_answer_unlisted_url") {
    return "Require the agent's final answer to include the clean unlisted_url, not only raw publish JSON or tool output.";
  }
  if (failure.startsWith("judge_failed:")) {
    return "Retry judging with available provider credits and a bounded judge.max_output_tokens value.";
  }
  return undefined;
}
