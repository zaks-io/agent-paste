import { emitWorkerLog } from "@agent-paste/worker-runtime/logging";

export function logOp(event: string, fields: Record<string, unknown>): void {
  emitWorkerLog({ level: "info", component: "jobs", event, attributes: fields });
}

export function logOpError(event: string, fields: Record<string, unknown>): void {
  emitWorkerLog({ level: "error", component: "jobs", event, attributes: fields });
}
