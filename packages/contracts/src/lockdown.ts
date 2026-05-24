import { PageInfo } from "./common.js";
import { IsoDateTime } from "./primitives.js";
import { z } from "./zod.js";

export const LockdownScope = z.enum(["workspace", "artifact"]);
export type LockdownScope = z.infer<typeof LockdownScope>;

export const SetLockdownRequest = z.object({
  scope: LockdownScope,
  target_id: z.string().min(1),
  reason_code: z.string().min(1).max(120),
});
export type SetLockdownRequest = z.infer<typeof SetLockdownRequest>;

export const LockdownDetail = z.object({
  scope: LockdownScope,
  target_id: z.string().min(1),
  reason_code: z.string().min(1).max(120),
  set_at: IsoDateTime,
  set_by: z.string().min(1),
  lifted_at: IsoDateTime.nullable(),
  lifted_by: z.string().min(1).nullable(),
});
export type LockdownDetail = z.infer<typeof LockdownDetail>;

export const LockdownListResponse = z.object({
  items: z.array(LockdownDetail),
  page_info: PageInfo,
});
export type LockdownListResponse = z.infer<typeof LockdownListResponse>;
