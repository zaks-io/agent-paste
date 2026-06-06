import { describe, expect, it } from "vitest";
import { OperationEvent } from "./admin.js";
import { OperationEventTargetType } from "./enums.js";
import { WebOperatorEventRow } from "./web.js";

const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const workspaceId = "3f13401f-1fdc-4bb7-85ff-9c73e357b16a";

describe("operation event contracts", () => {
  it("accepts revision as an operation event target type", () => {
    expect(OperationEventTargetType.parse("revision")).toBe("revision");
  });

  it("parses revision-target lifecycle events emitted by jobs", () => {
    const retained = OperationEvent.parse({
      id: "evt_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
      workspace_id: workspaceId,
      actor_type: "system",
      actor_id: "retention",
      action: "revision.retained",
      target_type: "revision",
      target_id: revisionId,
      details: { artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9", reason: "retention" },
      request_id: null,
      occurred_at: "2026-06-04T00:00:00.000Z",
    });
    expect(retained.target_type).toBe("revision");

    const warnings = OperationEvent.parse({
      id: "evt_01HZY7Q8X9Y2S3T4V5W6X7Y8Z0",
      workspace_id: workspaceId,
      actor_type: "platform",
      actor_id: "safety_scan",
      action: "safety_warnings.replaced",
      target_type: "revision",
      target_id: revisionId,
      details: { scanner_id: "url_scanner", warning_count: 1, added: 1, removed: 0, unchanged: 0 },
      request_id: null,
      occurred_at: "2026-06-04T00:00:01.000Z",
    });
    expect(warnings.target_type).toBe("revision");
  });

  it("parses revision-target operator event rows for the web admin surface", () => {
    const row = WebOperatorEventRow.parse({
      id: "evt_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
      time: "2026-06-04T00:00:00.000Z",
      actor: "system:retention",
      actor_type: "system",
      action: "revision.retained",
      target: `revision:${revisionId}`,
      target_type: "revision",
      workspace_id: workspaceId,
      change_summary: "artifact_id=art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9, reason=retention",
      request_id: "req_retention",
    });
    expect(row.target_type).toBe("revision");
  });
});
