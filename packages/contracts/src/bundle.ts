import { IsoDateTime } from "./primitives.js";
import { z } from "./zod.js";

export const BundleStatus = z.enum(["pending", "ready", "failed", "disabled"]);
export type BundleStatus = z.infer<typeof BundleStatus>;

export const BundleAvailabilityPending = z
  .object({
    status: z.literal("pending"),
    retry_after_seconds: z.number().int().positive(),
  })
  .strict();

export const BundleAvailabilityReady = z
  .object({
    status: z.literal("ready"),
    url: z.string().url(),
    size_bytes: z.number().int().nonnegative(),
    generated_at: IsoDateTime,
  })
  .strict();

export const BundleAvailabilityFailed = z
  .object({
    status: z.literal("failed"),
  })
  .strict();

export const BundleAvailabilityDisabled = z
  .object({
    status: z.literal("disabled"),
  })
  .strict();

export const BundleAvailability = z.discriminatedUnion("status", [
  BundleAvailabilityPending,
  BundleAvailabilityReady,
  BundleAvailabilityFailed,
  BundleAvailabilityDisabled,
]);
export type BundleAvailability = z.infer<typeof BundleAvailability>;
