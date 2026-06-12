import { describe, expect, it } from "vitest";
import {
  buildAgentView,
  buildBundleAvailability,
  buildFinalizeResult,
  buildPublishResult,
  inferRenderMode,
  resolveRenderMode,
} from "./agent-view.js";
import type { Artifact, SafetyWarning, StoredFile } from "./types.js";

const artifact: Artifact = {
  id: "art_1",
  workspace_id: "ws_1",
  revision_id: "rev_1",
  status: "active",
  title: "Demo",
  entrypoint: "docs/read me.md",
  file_count: 1,
  size_bytes: 12,
  expires_at: "2026-02-01T00:00:00.000Z",
  pinned_at: null,
  created_by_type: "api_key",
  created_by_id: "key_1",
  access_link_lockdown_at: null,
  deleted_at: null,
  delete_reason: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const file: StoredFile = {
  workspace_id: "ws_1",
  artifact_id: "art_1",
  revision_id: "rev_1",
  path: "docs/read me.md",
  size_bytes: 12,
  content_type: "text/markdown",
  r2_key: "r2/docs/read me.md",
  uploaded_at: "2026-01-01T00:00:00.000Z",
};

describe("agent-view helpers", () => {
  it("builds agent view and publish URLs with encoded paths", () => {
    const view = buildAgentView(artifact, "rev_2", [file], "https://content.test/", {
      render_mode: "markdown",
      bundle_status: "pending",
      bundle_status_updated_at: "2026-01-01T00:00:00.000Z",
      bundle_size_bytes: null,
    });
    expect(view.revision_id).toBe("rev_2");
    expect(view.render_mode).toBe("markdown");
    expect(view.bundle).toEqual({ status: "pending", retry_after_seconds: 5 });
    expect(view.revision_content_url).toBe("https://content.test/v/art_1.rev_2/docs/read%20me.md");
    expect(view.files[0]?.url).toContain("read%20me.md");

    const publishedRevision = {
      id: "rev_2",
      render_mode: "markdown" as const,
      bundle_status: "pending" as const,
      bundle_status_updated_at: "2026-01-01T00:00:00.000Z",
      bundle_size_bytes: null,
    };
    expect(
      buildPublishResult(artifact, publishedRevision, "upl_1", {
        contentBaseUrl: "https://content.test",
        apiBaseUrl: "https://api.test",
        webBaseUrl: "https://app.test",
      }),
    ).toMatchObject({
      upload_session_id: "upl_1",
      render_mode: "markdown",
      artifact_url: "https://app.test/artifacts/art_1",
      revision_content_url: "https://content.test/v/art_1.rev_2/docs/read%20me.md",
      agent_view_url: "https://api.test/v1/public/agent-view/art_1.rev_2",
      bundle: { status: "pending", retry_after_seconds: 5 },
    });
    expect(
      buildPublishResult(artifact, publishedRevision, undefined, {
        contentBaseUrl: "https://content.test",
        apiBaseUrl: "https://api.test",
        webBaseUrl: "https://app.test",
      }),
    ).not.toHaveProperty("upload_session_id");
  });

  it("builds finalize draft metadata", () => {
    expect(
      buildFinalizeResult({
        uploadSessionId: "upl_1",
        artifactId: "art_1",
        revisionId: "rev_1",
        title: "Demo",
        entrypoint: "index.html",
        fileCount: 1,
        sizeBytes: 12,
      }),
    ).toEqual({
      upload_session_id: "upl_1",
      artifact_id: "art_1",
      revision_id: "rev_1",
      status: "draft",
      title: "Demo",
      entrypoint: "index.html",
      file_count: 1,
      size_bytes: 12,
    });
  });

  it("caps safety warnings to the Agent View contract limit", () => {
    const warnings: SafetyWarning[] = Array.from({ length: 101 }, (_, index) => ({
      id: `warn_${index}`,
      workspace_id: artifact.workspace_id,
      artifact_id: artifact.id,
      revision_id: artifact.revision_id ?? "rev_1",
      scanner_id: "builtin_content",
      scanner_version: "1",
      code: `warning_${index}`,
      severity: "info",
      scope: "file",
      file_path: file.path,
      message: "Warning.",
      created_at: "2026-01-01T00:00:00.000Z",
    }));

    const view = buildAgentView(
      artifact,
      "rev_1",
      [file],
      "https://content.test",
      {
        render_mode: "html",
        bundle_status: "pending",
        bundle_status_updated_at: null,
        bundle_size_bytes: null,
      },
      warnings,
    );

    expect(view.safety_warnings).toHaveLength(100);
  });

  it("builds bundle availability for each terminal state", () => {
    expect(
      buildBundleAvailability({
        bundle_status: "ready",
        bundle_status_updated_at: "2026-01-01T00:00:00.000Z",
        bundle_size_bytes: 42,
      }),
    ).toEqual({
      status: "ready",
      size_bytes: 42,
      generated_at: "2026-01-01T00:00:00.000Z",
    });
    expect(
      buildBundleAvailability({
        bundle_status: "ready",
        bundle_status_updated_at: null,
        bundle_size_bytes: null,
      }),
    ).toEqual({
      status: "ready",
    });
    expect(
      buildBundleAvailability({
        bundle_status: "failed",
        bundle_status_updated_at: "2026-01-01T00:00:00.000Z",
        bundle_size_bytes: null,
      }),
    ).toEqual({ status: "failed" });
    expect(
      buildBundleAvailability({
        bundle_status: "disabled",
        bundle_status_updated_at: null,
        bundle_size_bytes: null,
      }),
    ).toEqual({ status: "disabled" });
  });

  it.each([
    ["index.html", "html"],
    ["README.md", "markdown"],
    ["notes.markdown", "markdown"],
    ["photo.png", "image"],
    ["clip.mp4", "video"],
    ["audio.mp3", "audio"],
    ["plain.txt", "text"],
  ] as const)("infers render mode %s -> %s", (entrypoint, renderMode) => {
    expect(inferRenderMode(entrypoint)).toBe(renderMode);
  });

  it("prefers persisted render_mode over entrypoint inference", () => {
    expect(resolveRenderMode("markdown", "index.html")).toBe("markdown");
    expect(resolveRenderMode(undefined, "clip.mov")).toBe("video");
    expect(resolveRenderMode(null, "index.html")).toBe("html");
  });
});
