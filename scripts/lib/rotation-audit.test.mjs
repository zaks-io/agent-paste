import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { appendRotationAuditRecord } from "./rotation-audit.mjs";

const auditLog = join(dirname(fileURLToPath(import.meta.url)), "../../var/ops/rotation-audit.jsonl");

describe("appendRotationAuditRecord", () => {
  it("appends a JSON line to the gitignored ops audit log", () => {
    const marker = `test-${process.pid}-${process.hrtime.bigint()}`;
    appendRotationAuditRecord({ marker, profile: "content-signing", step: "stage" });

    const lines = readFileSync(auditLog, "utf8").trim().split("\n");
    const written = lines.map((line) => JSON.parse(line)).find((record) => record.marker === marker);

    expect(written).toEqual({ marker, profile: "content-signing", step: "stage" });
  });
});
