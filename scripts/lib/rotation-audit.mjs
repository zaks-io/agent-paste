import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AUDIT_LOG = join(dirname(fileURLToPath(import.meta.url)), "../../var/ops/rotation-audit.jsonl");

/** Append a durable rotation audit record (operator identity is not written to wrangler). */
export function appendRotationAuditRecord(record) {
  mkdirSync(dirname(AUDIT_LOG), { recursive: true });
  appendFileSync(AUDIT_LOG, `${JSON.stringify(record)}\n`, "utf8");
}
