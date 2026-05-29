import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  contentTypeForLocalPath,
  expiresAtFromTtl,
  inferPublishOptions,
  parseTtlSeconds,
  validateFilesAgainstUsagePolicy,
  walkLocalPath,
} from "../src/local.js";

describe("local publish helpers", () => {
  it("walks local folders, excludes unsafe defaults, and hashes files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-"));
    await fs.mkdir(path.join(root, "node_modules"));
    await fs.mkdir(path.join(root, "nested"));
    await fs.writeFile(path.join(root, "index.html"), "<h1>Hello</h1>");
    await fs.writeFile(path.join(root, ".env"), "SECRET=yes");
    await fs.writeFile(path.join(root, "node_modules", "left-pad.js"), "");
    await fs.writeFile(path.join(root, "nested", "note.txt"), "note");

    const files = await walkLocalPath(root);

    expect(files.map((file) => file.path)).toEqual(["index.html", "nested/note.txt"]);
    expect(files[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
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

  it("rejects folders without an inferred entrypoint", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-"));
    await fs.writeFile(path.join(root, "a.txt"), "a");
    await fs.writeFile(path.join(root, "b.txt"), "b");

    const files = await walkLocalPath(root);
    expect(() => inferPublishOptions(root, files)).toThrow(/Could not infer entrypoint/);
  });

  it("parses TTLs and enforces caps", () => {
    expect(parseTtlSeconds("2h")).toBe(7200);
    expect(expiresAtFromTtl("1d", new Date("2026-01-01T00:00:00.000Z"), 2)).toBe("2026-01-02T00:00:00.000Z");
    expect(() => expiresAtFromTtl("3d", new Date("2026-01-01T00:00:00.000Z"), 2)).toThrow(/cap/);
  });

  it("maps upload content types", () => {
    expect(contentTypeForLocalPath("index.html")).toBe("text/html; charset=utf-8");
    expect(contentTypeForLocalPath("assets/app.js")).toBe("application/javascript; charset=utf-8");
    expect(contentTypeForLocalPath("image.png")).toBe("image/png");
    expect(contentTypeForLocalPath("paper.pdf")).toBe("application/pdf");
  });

  it("validates usage-policy caps before upload", () => {
    const files = [
      { path: "a.txt", absolutePath: "/tmp/a.txt", sizeBytes: 10, sha256: "a".repeat(64) },
      { path: "b.txt", absolutePath: "/tmp/b.txt", sizeBytes: 11, sha256: "b".repeat(64) },
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
      }),
    ).not.toThrow();

    expect(() =>
      validateFilesAgainstUsagePolicy(
        [{ path: "large.bin", absolutePath: "/tmp/large.bin", sizeBytes: 11 * 1024 * 1024, sha256: "c".repeat(64) }],
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
        },
      ),
    ).toThrow(/exceeds cap/);
  });
});
