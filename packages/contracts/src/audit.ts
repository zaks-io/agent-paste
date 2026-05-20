import { z } from "zod";
import { PageInfo } from "./common.js";
import { ActorType } from "./enums.js";
import { AuditEventId, IsoDateTime } from "./primitives.js";

export const AuditEvent = z.object({
  id: AuditEventId,
  actor: z.object({
    type: ActorType,
    id: z.string().min(1),
    display: z.string().min(1).max(200),
  }),
  action: z.string().regex(/^[a-z0-9_.]+$/),
  target: z.object({
    type: z.string().regex(/^[a-z0-9_]+$/),
    id: z.string().min(1),
  }),
  change_summary: z.record(z.string(), z.unknown()),
  request_id: z.string().min(1).nullable(),
  occurred_at: IsoDateTime,
});
export type AuditEvent = z.infer<typeof AuditEvent>;

export const AuditEventListResponse = z.object({
  data: z.array(AuditEvent),
  page_info: PageInfo,
});
export type AuditEventListResponse = z.infer<typeof AuditEventListResponse>;
