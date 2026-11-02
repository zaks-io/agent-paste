import * as z from "zod";
import { ArtifactId, IsoDateTime, UrlString } from "./primitives.js";

export const Retention = z.enum(["pinned", "temporary"]);
export type Retention = z.infer<typeof Retention>;
export const ArtifactRetention = z
  .object({
    artifact_id: ArtifactId,
    url: UrlString,
    retention: Retention,
    pinned_at: IsoDateTime.nullable(),
    expires_at: IsoDateTime,
    effective_expires_at: IsoDateTime.nullable(),
    pinned_count: z.number().int().nonnegative(),
    pin_allowance: z.number().int().positive(),
  })
  .strict();
export type ArtifactRetention = z.infer<typeof ArtifactRetention>;
