import * as z from "zod";
export const StorageUsage = z
  .object({
    budget_bytes: z.number().int().positive(),
    used_bytes: z.number().int().nonnegative(),
    reserved_bytes: z.number().int().nonnegative(),
    breakdown: z
      .object({
        blob_bytes: z.number().int().nonnegative(),
        legacy_file_bytes: z.number().int().nonnegative(),
        bundle_bytes: z.number().int().nonnegative(),
        file_entry_bytes: z.number().int().nonnegative(),
      })
      .strict(),
    pins: z
      .object({ pinned_count: z.number().int().nonnegative(), pin_allowance: z.number().int().positive() })
      .strict(),
  })
  .strict();
export type StorageUsage = z.infer<typeof StorageUsage>;
