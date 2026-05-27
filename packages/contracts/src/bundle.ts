import { IsoDateTime } from "./primitives.js";
import { z } from "./zod.js";

export const BundleStatus = z.enum(["pending", "ready", "failed", "disabled"]);
export type BundleStatus = z.infer<typeof BundleStatus>;

export const BundleAvailability = z
  .object({
    status: BundleStatus,
    url: z.string().url().optional(),
    size_bytes: z.number().int().nonnegative().optional(),
    generated_at: IsoDateTime.optional(),
    retry_after_seconds: z.number().int().positive().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.status === "ready") {
      if (value.url === undefined) {
        ctx.addIssue({ code: "custom", message: "ready bundles require url", path: ["url"] });
      }
      if (value.size_bytes === undefined) {
        ctx.addIssue({ code: "custom", message: "ready bundles require size_bytes", path: ["size_bytes"] });
      }
    }
    if (value.status === "pending" && value.retry_after_seconds === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "pending bundles require retry_after_seconds",
        path: ["retry_after_seconds"],
      });
    }
    if (value.status === "failed" || value.status === "disabled") {
      if (value.url !== undefined || value.size_bytes !== undefined || value.retry_after_seconds !== undefined) {
        ctx.addIssue({ code: "custom", message: "terminal bundle states omit url and size hints" });
      }
    }
  });
export type BundleAvailability = z.infer<typeof BundleAvailability>;
