import * as z from "zod";

export const MAX_FEEDBACK_BODY_CHARACTERS = 10_000;
export const MAX_FEEDBACK_CONTEXT_BYTES = 8_192;
export const FeedbackId = z.string().regex(/^fb_[0-9A-HJKMNP-TV-Z]{26}$/);
const feedbackText = z.string().refine((value) => !value.includes("\u0000"), "Must not contain NUL characters");
export const FeedbackBody = feedbackText.trim().min(1).max(MAX_FEEDBACK_BODY_CHARACTERS);
export const FeedbackContext = z
  .record(feedbackText.min(1).max(100), z.union([feedbackText.max(500), z.number().finite(), z.boolean(), z.null()]))
  .refine((context) => Object.keys(context).length <= 20, "Context may contain at most 20 fields")
  .refine(
    (context) =>
      Array.from(JSON.stringify(context)).reduce((bytes, character) => {
        const point = character.codePointAt(0) ?? 0;
        return bytes + (point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4);
      }, 0) <= MAX_FEEDBACK_CONTEXT_BYTES,
    "Context may contain at most 8192 UTF-8 bytes",
  );
export type FeedbackContext = z.infer<typeof FeedbackContext>;

export const CreateFeedbackRequest = z.object({ body: FeedbackBody, context: FeedbackContext.optional() }).strict();
export type CreateFeedbackRequest = z.infer<typeof CreateFeedbackRequest>;
export const CreateFeedbackResponse = z.object({ feedback_id: FeedbackId });
export type CreateFeedbackResponse = z.infer<typeof CreateFeedbackResponse>;
