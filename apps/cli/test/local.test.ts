import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Mebibytes } from "@agent-paste/contracts";
import { FsSafeError } from "@openclaw/fs-safe";
import { describe, expect, it, vi } from "vitest";
import {
  contentTypeForLocalPath,
  inferPublishOptions,
  type LocalFile,
  readAndHashLocalFile,
  validateFilesAgainstUsagePolicy,
  walkLocalPath,
} from "../src/local.js";

function unusedSafeRoot(rootReal: string): LocalFile["safeRoot"] {
  return {
    rootReal,
    async read() {
      throw new Error("unused_test_reader");
    },
  };
}

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

  it("follows in-root symlinked files and directories, skips broken links, and survives cycles", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-"));
    await fs.writeFile(path.join(root, "index.html"), "<h1>Hello</h1>");
    // Real assets living inside the publish root, aliased through symlinks.
    await fs.mkdir(path.join(root, "src"));
    await fs.writeFile(path.join(root, "src", "asset.css"), "body{}");
    await fs.mkdir(path.join(root, "src", "deep"));
    await fs.writeFile(path.join(root, "src", "deep", "note.txt"), "note");
    await fs.symlink(path.join(root, "src", "asset.css"), path.join(root, "asset.css"));
    await fs.symlink(path.join(root, "src", "deep"), path.join(root, "deep"));
    await fs.symlink(path.join(root, "missing.txt"), path.join(root, "broken.txt"));
    await fs.symlink(root, path.join(root, "self"));

    const files = await walkLocalPath(root);

    expect(files.map((file) => file.path)).toEqual([
      "asset.css",
      "deep/note.txt",
      "index.html",
      "src/asset.css",
      "src/deep/note.txt",
    ]);
  });

  it("does not upload bytes outside the publish root through symlinks (AP-408)", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-"));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-outside-"));
    await fs.writeFile(path.join(root, "index.html"), "<h1>Hello</h1>");
    // A secret outside the selected folder, plus an innocuously named symlink
    // that would bypass the .env exclusion list if the link were followed.
    await fs.writeFile(path.join(outside, "secret.txt"), "top secret");
    await fs.writeFile(path.join(root, ".env"), "TOKEN=abc");
    await fs.mkdir(path.join(outside, "vendor"));
    await fs.writeFile(path.join(outside, "vendor", "lib.js"), "x");
    await fs.symlink(path.join(outside, "secret.txt"), path.join(root, "data.json"));
    await fs.symlink(path.join(outside, "vendor"), path.join(root, "vendor"));
    await fs.symlink(path.join(root, ".env"), path.join(root, "config.json"));

    const warn = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const files = await walkLocalPath(root);

    // Only the real in-root file is uploaded; every outside-root or
    // exclusion-aliasing symlink is skipped.
    expect(files.map((file) => file.path)).toEqual(["index.html"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("buffers file bytes once while computing sha256 for upload", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-"));
    const filePath = path.join(root, "index.html");
    const body = "<h1>Hello</h1>";
    await fs.writeFile(filePath, body);

    const [file] = await walkLocalPath(filePath);
    if (!file) throw new Error("expected_file");
    const read = await readAndHashLocalFile(file);

    expect(read.sha256).toBe(createHash("sha256").update(body).digest("hex"));
    expect(read.sizeBytes).toBe(new TextEncoder().encode(body).byteLength);
    expect(new TextDecoder().decode(read.bytes)).toBe(body);
  });

  it("preserves operational read errors and wraps confirmed path changes", async () => {
    const operationalError = new Error("permission denied");
    const pathChangeError = new FsSafeError("path-mismatch", "path changed during read");
    const file = (error: Error): LocalFile => ({
      absolutePath: "/publish/index.html",
      safeRoot: {
        rootReal: "/publish",
        async read() {
          throw error;
        },
      },
      rootRelativePath: "index.html",
      enforceExclusions: true,
      path: "index.html",
      sizeBytes: 1,
    });

    await expect(readAndHashLocalFile(file(operationalError))).rejects.toBe(operationalError);
    await expect(readAndHashLocalFile(file(pathChangeError))).rejects.toMatchObject({
      message: expect.stringMatching(/changed after validation/),
      cause: pathChangeError,
    });
  });

  it("reads an excluded filename when the caller selects that single file explicitly", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-"));
    const filePath = path.join(root, ".env");
    await fs.writeFile(filePath, "SELECTED=yes");
    const [file] = await walkLocalPath(filePath);
    if (!file) throw new Error("expected_file");

    const read = await readAndHashLocalFile(file);

    expect(new TextDecoder().decode(read.bytes)).toBe("SELECTED=yes");
  });

  it("rejects a symlink swapped outside after validation", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-"));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-outside-"));
    const target = path.join(root, "target.txt");
    const link = path.join(root, "asset.txt");
    await fs.writeFile(target, "approved");
    await fs.writeFile(path.join(outside, "secret.txt"), "secret");
    await fs.symlink(target, link);
    const files = await walkLocalPath(root);
    const file = files.find((candidate) => candidate.path === "asset.txt");
    if (!file) throw new Error("expected_symlink");

    await fs.unlink(link);
    await fs.symlink(path.join(outside, "secret.txt"), link);

    await expect(readAndHashLocalFile(file)).rejects.toThrow(/changed after validation/);
  });

  it("rejects the selected root swapped to an outside directory after validation", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-"));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-outside-"));
    await fs.writeFile(path.join(root, "index.html"), "approved");
    await fs.writeFile(path.join(outside, "index.html"), "secret");
    const [file] = await walkLocalPath(root);
    if (!file) throw new Error("expected_file");

    await fs.rename(root, `${root}-approved`);
    await fs.symlink(outside, root);

    await expect(readAndHashLocalFile(file)).rejects.toThrow(/changed after validation/);
  });

  it("rejects an allowed symlink retargeted to an excluded file", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-"));
    const target = path.join(root, "safe.txt");
    const link = path.join(root, "config.txt");
    await fs.writeFile(target, "approved");
    await fs.writeFile(path.join(root, ".env"), "SECRET=excluded");
    await fs.symlink(target, link);
    const files = await walkLocalPath(root);
    const file = files.find((candidate) => candidate.path === "config.txt");
    if (!file) throw new Error("expected_symlink");

    await fs.unlink(link);
    await fs.symlink(path.join(root, ".env"), link);

    await expect(readAndHashLocalFile(file)).rejects.toThrow(/resolves to an excluded target/);
  });

  it("rejects an ancestor directory swapped outside the publish root after validation", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-"));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-outside-"));
    const directory = path.join(root, "assets");
    await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, "data.txt"), "approved");
    await fs.writeFile(path.join(outside, "data.txt"), "secret");
    const files = await walkLocalPath(root);
    const file = files.find((candidate) => candidate.path === "assets/data.txt");
    if (!file) throw new Error("expected_file");

    await fs.rename(directory, path.join(root, "approved-assets"));
    await fs.symlink(outside, directory);

    await expect(readAndHashLocalFile(file)).rejects.toThrow(/changed after validation/);
  });

  it("never reads outside bytes when an ancestor changes while file metadata is recorded", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-"));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-outside-"));
    const directory = path.join(root, "assets");
    const filePath = path.join(directory, "data.txt");
    await fs.mkdir(directory);
    await fs.writeFile(filePath, "approved");
    await fs.writeFile(path.join(outside, "data.txt"), "secret");
    const resolvedFilePath = await fs.realpath(filePath);

    const stat = fs.stat.bind(fs);
    let swapped = false;
    const statSpy = vi.spyOn(fs, "stat").mockImplementation(async (candidate) => {
      if (!swapped && candidate === resolvedFilePath) {
        swapped = true;
        await fs.rename(directory, path.join(root, "approved-assets"));
        await fs.symlink(outside, directory);
      }
      return stat(candidate);
    });
    let files: Awaited<ReturnType<typeof walkLocalPath>>;
    try {
      files = await walkLocalPath(root);
    } finally {
      statSpy.mockRestore();
    }
    expect(swapped).toBe(true);
    const file = files.find((candidate) => candidate.path === "assets/data.txt");
    if (!file) throw new Error("expected_file");

    const outcome = await readAndHashLocalFile(file).then(
      (read) => ({ kind: "read" as const, read }),
      (error: unknown) => ({ kind: "rejected" as const, error }),
    );
    if (outcome.kind === "read") {
      expect(new TextDecoder().decode(outcome.read.bytes)).toBe("approved");
    } else {
      expect(outcome.error).toEqual(
        expect.objectContaining({ message: expect.stringMatching(/changed after validation/) }),
      );
    }
  });

  it("reads a stable in-root symlink and preserves those exact bytes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-paste-"));
    const target = path.join(root, "target.txt");
    await fs.writeFile(target, "approved");
    await fs.symlink(target, path.join(root, "asset.txt"));
    const files = await walkLocalPath(root);
    const file = files.find((candidate) => candidate.path === "asset.txt");
    if (!file) throw new Error("expected_symlink");

    const read = await readAndHashLocalFile(file);
    expect(new TextDecoder().decode(read.bytes)).toBe("approved");
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
      {
        path: "a.txt",
        absolutePath: "/tmp/a.txt",
        safeRoot: unusedSafeRoot("/tmp"),
        rootRelativePath: "a.txt",
        enforceExclusions: true,
        sizeBytes: 10,
      },
      {
        path: "b.txt",
        absolutePath: "/tmp/b.txt",
        safeRoot: unusedSafeRoot("/tmp"),
        rootRelativePath: "b.txt",
        enforceExclusions: true,
        sizeBytes: 11,
      },
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
        [
          {
            path: "large.bin",
            absolutePath: "/tmp/large.bin",
            safeRoot: unusedSafeRoot("/tmp"),
            rootRelativePath: "large.bin",
            enforceExclusions: true,
            sizeBytes: 11 * 1024 * 1024,
          },
        ],
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
