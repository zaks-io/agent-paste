import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Mebibytes } from "@agent-paste/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  contentTypeForLocalPath,
  inferPublishOptions,
  sha256HexForFile,
  validateFilesAgainstUsagePolicy,
  walkLocalPath,
} from "../src/local.js";

describe("local publish helpers", () => {
  it("walks local folders, excludes unsafe defaults, and records size from stat only", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-"));
    await fs.mkdir(path.join(root, "node_modules"));
    await fs.mkdir(path.join(root, "nested"));
    await fs.writeFile(path.join(root, "index.html"), "<h1>Hello</h1>");
    await fs.writeFile(path.join(root, ".env"), "SECRET=yes");
    await fs.writeFile(path.join(root, "node_modules", "left-pad.js"), "");
    await fs.writeFile(path.join(root, "nested", "note.txt"), "note");

    const readFile = vi.spyOn(fs, "readFile");
    const files = await walkLocalPath(root);

    expect(readFile).not.toHaveBeenCalled();
    expect(files.map((file) => file.path)).toEqual(["index.html", "nested/note.txt"]);
    expect(files[0]?.sizeBytes).toBe(new TextEncoder().encode("<h1>Hello</h1>").byteLength);
    expect(files[0]).not.toHaveProperty("sha256");
  });

  it("streams file bytes when computing sha256 for upload", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-"));
    const filePath = path.join(root, "index.html");
    const body = "<h1>Hello</h1>";
    await fs.writeFile(filePath, body);

    const readFile = vi.spyOn(fs, "readFile");
    const sha256 = await sha256HexForFile(filePath);

    expect(readFile).not.toHaveBeenCalled();
    expect(sha256).toBe(createHash("sha256").update(body).digest("hex"));
  });

  it("fails fast on a file larger than the absolute per-file ceiling, before reading it", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-"));
    const big = path.join(root, "big.bin");
    // A sparse file: stat reports an oversized length but no real bytes are written
    // or read, so this proves the guard fires on `stat`, not after `readFile`.
    await fs.writeFile(big, "");
    await fs.truncate(big, Mebibytes.twentyFive + 1);

    await expect(walkLocalPath(root)).rejects.toThrow(/per-file limit/);
  });

  it("infers title, entrypoint, and render mode", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-"));
    await fs.writeFile(path.join(root, "README.md"), "# Hello");

    const files = await walkLocalPath(root);
    expect(inferPublishOptions(root, files)).toEqual({
      title: path.basename(root),
      entrypoint: "README.md",
      renderMode: "markdown",
    });
  });

  it.each([
    ["clip.mov", "video"],
    ["voice.m4a", "audio"],
    ["sound.ogg", "audio"],
    ["plain.text", "text"],
  ] as const)("infers render mode for single-file %s as %s (shared map with the server)", async (name, mode) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-"));
    await fs.writeFile(path.join(root, name), "bytes");

    const files = await walkLocalPath(root);
    expect(inferPublishOptions(root, files)).toMatchObject({ entrypoint: name, renderMode: mode });
  });

  it("refuses to infer a render mode for unknown extensions", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-"));
    await fs.writeFile(path.join(root, "data.json"), "{}");

    const files = await walkLocalPath(root);
    expect(() => inferPublishOptions(root, files)).toThrow(/render mode/);
  });

  it("rejects folders without an inferred entrypoint", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-"));
    await fs.writeFile(path.join(root, "a.txt"), "a");
    await fs.writeFile(path.join(root, "b.txt"), "b");

    const files = await walkLocalPath(root);
    expect(() => inferPublishOptions(root, files)).toThrow(/Could not infer entrypoint/);
  });

  it("maps upload content types", () => {
    expect(contentTypeForLocalPath("index.html")).toBe("text/html; charset=utf-8");
    expect(contentTypeForLocalPath("assets/app.js")).toBe("application/javascript; charset=utf-8");
    expect(contentTypeForLocalPath("image.png")).toBe("image/png");
    expect(contentTypeForLocalPath("paper.pdf")).toBe("application/pdf");
  });

  it("validates usage-policy caps before upload", () => {
    const files = [
      { path: "a.txt", absolutePath: "/tmp/a.txt", sizeBytes: 10 },
      { path: "b.txt", absolutePath: "/tmp/b.txt", sizeBytes: 11 },
    ];
    expect(() =>
      validateFilesAgainstUsagePolicy(files, {
        file_size_cap_bytes: 10 * 1024 * 1024,
        artifact_size_cap_bytes: 25 * 1024 * 1024,
        bundle_size_cap_bytes: 25 * 1024 * 1024,
        bundles_enabled: true,
        file_count_cap: 100,
        default_ttl_seconds: 30 * 24 * 60 * 60,
        min_ttl_seconds: 24 * 60 * 60,
        max_ttl_seconds: 90 * 24 * 60 * 60,
        upload_session_ttl_seconds: 24 * 60 * 60,
        actor_rate_limit_per_minute: 60,
        workspace_burst_cap_per_minute: 300,
        live_artifacts_cap: 50,
        live_update_enabled: false,
        daily_new_artifact_allowance: 100,
        lifetime_revision_ceiling: 100,
      }),
    ).not.toThrow();

    expect(() =>
      validateFilesAgainstUsagePolicy(
        [{ path: "large.bin", absolutePath: "/tmp/large.bin", sizeBytes: 11 * 1024 * 1024 }],
        {
          file_size_cap_bytes: 10 * 1024 * 1024,
          artifact_size_cap_bytes: 25 * 1024 * 1024,
          bundle_size_cap_bytes: 25 * 1024 * 1024,
          bundles_enabled: true,
          file_count_cap: 100,
          default_ttl_seconds: 30 * 24 * 60 * 60,
          min_ttl_seconds: 24 * 60 * 60,
          max_ttl_seconds: 90 * 24 * 60 * 60,
          upload_session_ttl_seconds: 24 * 60 * 60,
          actor_rate_limit_per_minute: 60,
          workspace_burst_cap_per_minute: 300,
          live_artifacts_cap: 50,
          live_update_enabled: false,
          daily_new_artifact_allowance: 100,
          lifetime_revision_ceiling: 100,
        },
      ),
    ).toThrow(/exceeds cap/);
  });
});
