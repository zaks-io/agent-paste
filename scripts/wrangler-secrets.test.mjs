import { describe, expect, it } from "vitest";
import { findSecretCollisions, listWorkerSecrets, parseSecretList, workerName } from "./wrangler-secrets.mjs";

describe("wrangler-secrets helpers", () => {
  it("builds hosted worker names from app and target", () => {
    expect(workerName("api", "preview")).toBe("agent-paste-api-preview");
    expect(workerName("stream", "production")).toBe("agent-paste-stream-production");
  });

  it("parses wrangler secret list JSON", () => {
    expect(parseSecretList('[{"name":"CONTENT_SIGNING_SECRET"},{"name":"API_KEY_PEPPER_V1"}]')).toEqual([
      "CONTENT_SIGNING_SECRET",
      "API_KEY_PEPPER_V1",
    ]);
  });

  it("rejects non-array wrangler secret list output", () => {
    expect(() => parseSecretList('{"name":"CONTENT_SIGNING_SECRET"}')).toThrow(/expected a JSON array/i);
  });

  it("surfaces wrangler list failures instead of treating them as empty", async () => {
    await expect(
      listWorkerSecrets("agent-paste-api-preview", async () => ({
        code: 1,
        stdout: "",
        stderr: "✘ Unknown argument --json",
      })),
    ).rejects.toThrow(/Failed to list Worker secrets for agent-paste-api-preview/i);
  });

  it("finds secret collisions per worker binding", () => {
    const existingByWorker = new Map([
      ["agent-paste-api-preview", new Set(["STREAM_INTERNAL_SECRET"])],
      ["agent-paste-stream-preview", new Set()],
    ]);
    expect(
      findSecretCollisions(
        [
          { worker: "agent-paste-api-preview", names: ["STREAM_INTERNAL_SECRET"] },
          { worker: "agent-paste-stream-preview", names: ["STREAM_INTERNAL_SECRET"] },
        ],
        existingByWorker,
      ),
    ).toEqual(["agent-paste-api-preview:STREAM_INTERNAL_SECRET"]);
  });
});
