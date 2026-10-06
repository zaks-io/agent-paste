import { feedbackQueries } from "../../queries/feedback.js";
import type { Entities } from "../ports.js";
import type { PostgresContext } from "./context.js";

export function postgresFeedback(ctx: PostgresContext): Entities["feedback"] {
  return {
    async insert(row) {
      try {
        await feedbackQueries.insert(ctx.drizzle, row);
      } catch (error) {
        // Drizzle includes bound report text and contact data in its error message.
        throw safeFeedbackInsertError(error);
      }
    },
    findById: (id) => feedbackQueries.findById(ctx.drizzle, id),
  };
}

function safeFeedbackInsertError(error: unknown): Error & { code?: string; constraint?: string } {
  const safe: Error & { code?: string; constraint?: string } = new Error("Feedback persistence failed");
  const driver = error instanceof Error && error.cause ? error.cause : error;
  if (typeof driver !== "object" || driver === null) return safe;
  const code = "code" in driver ? driver.code : undefined;
  if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) safe.code = code;
  const constraint = "constraint" in driver ? driver.constraint : undefined;
  const knownConstraints = [
    "feedback_member_fk",
    "feedback_api_key_fk",
    "feedback_submitter_check",
    "feedback_body_check",
    "feedback_context_check",
  ];
  if (typeof constraint === "string" && knownConstraints.includes(constraint)) safe.constraint = constraint;
  return safe;
}
