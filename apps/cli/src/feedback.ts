import { AgentPasteError, type ApiClient, createIdempotencyKey } from "@agent-paste/api-client";
import { CreateFeedbackRequest, MAX_FEEDBACK_BODY_CHARACTERS } from "@agent-paste/contracts/feedback";
import { output, outputModeFor, type Parsed } from "./cli-args.js";
import { paint } from "./render.js";
import { CLI_VERSION } from "./version.js";

export async function feedback(parsed: Parsed, client: ApiClient) {
  if (parsed.positionals.length > 1) {
    throw invalidFeedback("feedback: quote the body as one argument, or pipe it through stdin");
  }
  const body = parsed.positionals[0] ?? (await readFeedbackStdin());
  const request = CreateFeedbackRequest.safeParse({
    body,
    context: { surface: "cli", version: CLI_VERSION, command: "feedback" },
  });
  if (!request.success) {
    throw invalidFeedback(`feedback: body must contain 1 to ${MAX_FEEDBACK_BODY_CHARACTERS} characters`);
  }
  const result = await client.feedback.create(request.data, createIdempotencyKey("cli_feedback"));
  return output(result, parsed.global, paint(outputModeFor(parsed.global), "green", "Feedback submitted."));
}

function invalidFeedback(message: string) {
  return new AgentPasteError({ code: "invalid_request", message, status: 400 });
}

function readFeedbackStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw invalidFeedback("feedback: provide a body argument or pipe text through stdin");
  }
  return new Promise((resolve, reject) => {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let text = "";
    const cleanup = () => {
      process.stdin.removeListener("data", onData);
      process.stdin.removeListener("end", onEnd);
      process.stdin.removeListener("error", onError);
    };
    const onError = (error: unknown) => {
      cleanup();
      process.stdin.pause();
      reject(error);
    };
    const onData = (chunk: Uint8Array) => {
      try {
        text += decoder.decode(chunk, { stream: true });
        if (text.length > MAX_FEEDBACK_BODY_CHARACTERS) {
          onError(invalidFeedback(`feedback: body exceeds ${MAX_FEEDBACK_BODY_CHARACTERS} characters`));
        }
      } catch {
        onError(invalidFeedback("feedback: stdin must contain UTF-8 text"));
      }
    };
    const onEnd = () => {
      cleanup();
      try {
        resolve(text + decoder.decode());
      } catch {
        reject(invalidFeedback("feedback: stdin must contain UTF-8 text"));
      }
    };
    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
    process.stdin.on("error", onError);
  });
}
