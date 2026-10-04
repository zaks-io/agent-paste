import * as Sentry from "@sentry/cloudflare";
import { describe, expect, it, vi } from "vitest";
import { runPostCommitArtifactDeletionInvalidation } from "./deletion-invalidation.js";
import { enqueuePostPublishJobs } from "./post-publish.js";

const input = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  artifactId: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
  revisionId: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
  requestedAt: "2026-05-20T00:00:00.000Z",
};

describe("enqueuePostPublishJobs", () => {
  it("carries the active trace through parsed publish and deletion queue payloads", async () => {
    const pending: Promise<unknown>[] = [];
    const sent: Array<{ trace_context?: { "sentry-trace": string } }> = [];
    const queue = {
      send: async (message: unknown) => {
        sent.push(message as (typeof sent)[number]);
      },
    };
    const worker = Sentry.withSentry(
      () => ({
        dsn: "https://public@example.ingest.sentry.io/1",
        tracesSampleRate: 1,
        defaultIntegrations: [],
        skipOpenTelemetrySetup: true,
        transport: () => ({ send: async () => ({ statusCode: 200 }), flush: async () => true }),
      }),
      {
        async fetch() {
          const trace = Sentry.getTraceData()["sentry-trace"];
          await enqueuePostPublishJobs(
            { BUNDLE_GENERATE_QUEUE: queue, SAFETY_SCAN_QUEUE: queue },
            {
              ...input,
              bundleStatus: "pending",
            },
          );
          const deletion = await runPostCommitArtifactDeletionInvalidation(
            {
              DENYLIST: { put: async () => {} },
              BYTE_PURGE_QUEUE: queue,
              LOCAL_MVP_REPOSITORY: { revisions: new Map([[input.revisionId, {}]]) },
            },
            { ...input },
          );
          expect(deletion.enqueued).toBe(true);
          expect(sent).toHaveLength(3);
          for (const message of sent) expect(message.trace_context?.["sentry-trace"]).toBe(trace);
          return new Response("ok");
        },
      },
    );
    await worker.fetch(
      new Request("https://api.test/publish"),
      {},
      {
        waitUntil: (promise: Promise<unknown>) => {
          pending.push(promise);
        },
        passThroughOnException: () => {},
      },
    );
    await Promise.all(pending);
  });
  it("no-ops when bundle generation is disabled", async () => {
    const send = vi.fn();
    await enqueuePostPublishJobs({ BUNDLE_GENERATE_QUEUE: { send } }, { ...input, bundleStatus: "disabled" });
    expect(send).not.toHaveBeenCalled();
  });

  it("no-ops when the bundle queue binding is missing", async () => {
    await enqueuePostPublishJobs({}, { ...input, bundleStatus: "pending" });
  });

  it("enqueues bundle.generate.v1 when publish leaves bundle pending", async () => {
    const send = vi.fn(async () => ({}));
    await enqueuePostPublishJobs({ BUNDLE_GENERATE_QUEUE: { send } }, { ...input, bundleStatus: "pending" });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "bundle.generate.v1",
        workspace_id: input.workspaceId,
        artifact_id: input.artifactId,
        revision_id: input.revisionId,
        reason: "publish",
      }),
    );
  });

  it("enqueues safety.scan.v1 after publish", async () => {
    const send = vi.fn(async () => ({}));
    await enqueuePostPublishJobs({ SAFETY_SCAN_QUEUE: { send } }, { ...input, bundleStatus: "disabled" });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "safety.scan.v1",
        workspace_id: input.workspaceId,
        artifact_id: input.artifactId,
        revision_id: input.revisionId,
        scanner_id: "builtin_content",
        scanner_version: "1",
      }),
    );
  });

  it("enqueues the ephemeral scanner for unclaimed tiers", async () => {
    const send = vi.fn(async () => ({}));
    await enqueuePostPublishJobs(
      { SAFETY_SCAN_QUEUE: { send } },
      { ...input, bundleStatus: "disabled", ephemeralTier: true },
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        scanner_id: "ephemeral_tier",
        scanner_version: "1",
      }),
    );
  });
});
