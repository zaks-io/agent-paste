import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentPasteError, type ApiClient } from "@agent-paste/api-client";
import type { AgentView } from "@agent-paste/contracts/agent-view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type DownloadClock, download } from "./download.js";
import { parseArgs } from "./index.js";
import { EXIT_NETWORK, exitCodeFor } from "./render.js";

const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const bundleUrl = "https://usercontent.agent-paste.test/b/token";
const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);

let tmp: string;
let stdout: string[];

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "download-test-"));
  stdout = [];
  vi.spyOn(process.stdout, "write").mockImplementation(((value: string, callback?: () => void) => {
    stdout.push(value);
    callback?.();
    return true;
  }) as typeof process.stdout.write);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmp, { recursive: true, force: true });
});

function view(bundle: AgentView["bundle"]): AgentView {
  return {
    artifact_id: artifactId,
    revision_id: revisionId,
    title: "Report",
    created_at: "2026-01-01T00:00:00.000Z",
    expires_at: "2026-02-01T00:00:00.000Z",
    entrypoint: "index.html",
    revision_content_url: "https://usercontent.agent-paste.test/v/x/index.html",
    url: "https://01234-56789-abcde-fghjd.agent-paste.test/",
    files: [{ path: "index.html", size_bytes: 10, content_type: "text/html", url: "https://x.test/index.html" }],
    safety_warnings: [],
    bundle,
  } as unknown as AgentView;
}

const ready: AgentView["bundle"] = { status: "ready", url: bundleUrl, generated_at: "2026-01-01T00:00:05.000Z" };
const pending: AgentView["bundle"] = { status: "pending", retry_after_seconds: 5 };

function fakeClient(views: AgentView[], downloadSignedUrl = vi.fn().mockResolvedValue(zipBytes)) {
  const getAgentView = vi.fn().mockResolvedValue(views[0]);
  const getRevisionAgentView = vi.fn();
  for (const next of views.slice(1)) getRevisionAgentView.mockResolvedValueOnce(next);
  const client = { artifacts: { getAgentView, getRevisionAgentView }, downloadSignedUrl } as unknown as ApiClient;
  return { client, getAgentView, getRevisionAgentView, downloadSignedUrl };
}

function fakeClock(): DownloadClock & { sleeps: number[] } {
  let now = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
  };
}

describe("download", () => {
  it("writes the ready bundle to --output and reports it as JSON", async () => {
    const target = path.join(tmp, "report.zip");
    const { client, downloadSignedUrl } = fakeClient([view(ready)]);

    await download(parseArgs(["download", artifactId, "--output", target, "--json"]), client, fakeClock());

    expect(downloadSignedUrl).toHaveBeenCalledWith(bundleUrl);
    expect(new Uint8Array(await fs.readFile(target))).toEqual(zipBytes);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      artifact_id: artifactId,
      revision_id: revisionId,
      path: target,
      size_bytes: zipBytes.byteLength,
      schema_version: expect.any(String),
    });
  });

  it("names the file after the artifact ID when --output is omitted", async () => {
    vi.spyOn(process as unknown as { cwd: () => string }, "cwd").mockReturnValue(tmp);
    const { client } = fakeClient([view(ready)]);

    await download(parseArgs(["download", artifactId, "--json"]), client, fakeClock());

    expect(new Uint8Array(await fs.readFile(path.join(tmp, `${artifactId}.zip`)))).toEqual(zipBytes);
  });

  it("reads the requested revision when --revision-id is set", async () => {
    const { client, getAgentView, getRevisionAgentView } = fakeClient([view(ready)]);
    getRevisionAgentView.mockResolvedValue(view(ready));

    await download(
      parseArgs(["download", artifactId, "--revision-id", revisionId, "--output", path.join(tmp, "r.zip")]),
      client,
      fakeClock(),
    );

    expect(getAgentView).not.toHaveBeenCalled();
    expect(getRevisionAgentView).toHaveBeenCalledWith(artifactId, revisionId);
  });

  it("waits for a pending bundle on the same revision", async () => {
    const clock = fakeClock();
    const { client, getRevisionAgentView } = fakeClient([view(pending), view(pending), view(ready)]);

    await download(parseArgs(["download", artifactId, "--output", path.join(tmp, "w.zip")]), client, clock);

    expect(clock.sleeps).toEqual([5000, 5000]);
    expect(getRevisionAgentView).toHaveBeenCalledTimes(2);
    expect(getRevisionAgentView).toHaveBeenCalledWith(artifactId, revisionId);
  });

  it("gives up with a retryable error when the bundle stays pending", async () => {
    const target = path.join(tmp, "slow.zip");
    const { client, downloadSignedUrl, getRevisionAgentView } = fakeClient([view(pending)]);
    getRevisionAgentView.mockResolvedValue(view(pending));

    const error = await download(parseArgs(["download", artifactId, "--output", target]), client, fakeClock()).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(AgentPasteError);
    expect(exitCodeFor(error)).toBe(EXIT_NETWORK);
    expect((error as AgentPasteError).retryAfterSeconds).toBe(5);
    expect(downloadSignedUrl).not.toHaveBeenCalled();
    await expect(fs.lstat(target)).rejects.toThrow();
  });

  it.each([
    { status: "failed" as const },
    { status: "disabled" as const },
  ])("fails without downloading when the bundle is $status", async (bundle) => {
    const { client, downloadSignedUrl } = fakeClient([view(bundle)]);

    await expect(
      download(parseArgs(["download", artifactId, "--output", path.join(tmp, "x.zip")]), client, fakeClock()),
    ).rejects.toThrow(revisionId);
    expect(downloadSignedUrl).not.toHaveBeenCalled();
  });

  it("refuses to overwrite an existing file", async () => {
    const target = path.join(tmp, "existing.zip");
    await fs.writeFile(target, "keep me");
    const { client, downloadSignedUrl } = fakeClient([view(ready)]);

    await expect(
      download(parseArgs(["download", artifactId, "--output", target]), client, fakeClock()),
    ).rejects.toThrow(/already exists/);
    expect(downloadSignedUrl).not.toHaveBeenCalled();
    expect(await fs.readFile(target, "utf8")).toBe("keep me");
  });

  it("fails before any wait when the output directory is missing", async () => {
    const { client, downloadSignedUrl } = fakeClient([view(pending)]);
    const clock = fakeClock();

    await expect(
      download(parseArgs(["download", artifactId, "--output", path.join(tmp, "missing", "x.zip")]), client, clock),
    ).rejects.toThrow(/does not exist/);
    expect(clock.sleeps).toEqual([]);
    expect(downloadSignedUrl).not.toHaveBeenCalled();
  });

  it("never replaces a file that appears while the bundle is pending", async () => {
    const target = path.join(tmp, "race.zip");
    const { client } = fakeClient([view(pending), view(ready)]);
    const clock = fakeClock();
    const sleep = clock.sleep;
    clock.sleep = async (ms) => {
      await fs.writeFile(target, "arrived first");
      await sleep(ms);
    };

    await expect(download(parseArgs(["download", artifactId, "--output", target]), client, clock)).rejects.toThrow(
      /already exists/,
    );
    expect(await fs.readFile(target, "utf8")).toBe("arrived first");
  });

  it("leaves nothing behind when the bundle request fails", async () => {
    const failure = new AgentPasteError({ code: "not_found", message: "gone", status: 404 });
    const { client } = fakeClient([view(ready)], vi.fn().mockRejectedValue(failure));

    await expect(
      download(parseArgs(["download", artifactId, "--output", path.join(tmp, "gone.zip")]), client, fakeClock()),
    ).rejects.toBe(failure);
    expect(await fs.readdir(tmp, { withFileTypes: true })).toEqual([]);
  });
});
