import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config";
import { verifyRunOutput } from "./verifier";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe("verifyRunOutput", () => {
  it("treats production Agent Paste docs links as informational", async () => {
    const config = await loadConfig("config.smoke.yaml");
    const outputDir = await mkdtemp(join(tmpdir(), "agent-paste-eval-verifier-"));
    tempDirs.push(outputDir);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>ok</html>", { status: 200 })),
    );

    const result = await verifyRunOutput({
      config,
      finalAnswer: "Published: https://app.preview.agent-paste.sh/al/ABC123#token",
      outputDir,
      text: ["Published: https://app.preview.agent-paste.sh/al/ABC123#token", "Docs: https://agent-paste.sh/docs"].join(
        "\n",
      ),
    });

    expect(result.passed).toBe(true);
    expect(result.status).toBe(200);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.production_handoff_url_detected).toBe(false);
    expect(result.production_url_details).toEqual({ handoff: [], artifact: [] });
  });

  it("fails production handoff URLs for a preview eval", async () => {
    const config = await loadConfig("config.smoke.yaml");
    const outputDir = await mkdtemp(join(tmpdir(), "agent-paste-eval-verifier-"));
    const fetchSpy = vi.fn(async () => new Response("<html>ok</html>", { status: 200 }));
    tempDirs.push(outputDir);
    vi.stubGlobal("fetch", fetchSpy);

    const result = await verifyRunOutput({
      config,
      finalAnswer: "Published: https://app.agent-paste.sh/al/ABC123#token",
      outputDir,
      text: "Published: https://app.agent-paste.sh/al/ABC123#token",
    });

    expect(result.passed).toBe(false);
    expect(result.errors).toEqual(["wrong_environment_url:app.agent-paste.sh"]);
    expect(result.warnings).toEqual(["production_handoff_url_detected"]);
    expect(result.production_handoff_url_detected).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ignores production-looking non-handoff URLs outside the artifact", async () => {
    const config = await loadConfig("config.smoke.yaml");
    const outputDir = await mkdtemp(join(tmpdir(), "agent-paste-eval-verifier-"));
    tempDirs.push(outputDir);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>ok</html>", { status: 200 })),
    );

    const result = await verifyRunOutput({
      config,
      finalAnswer: "Published: https://app.preview.agent-paste.sh/al/ABC123#token",
      outputDir,
      text: [
        "Published: https://app.preview.agent-paste.sh/al/ABC123#token",
        "Example: https://api.agent-paste.sh/auth.md",
      ].join("\n"),
    });

    expect(result.passed).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.production_url_details).toEqual({ handoff: [], artifact: [] });
  });

  it("warns when the fetched artifact contains production handoff links", async () => {
    const config = await loadConfig("config.smoke.yaml");
    const outputDir = await mkdtemp(join(tmpdir(), "agent-paste-eval-verifier-"));
    tempDirs.push(outputDir);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('<a href="https://app.agent-paste.sh/al/prod#token">bad</a>', { status: 200 })),
    );

    const result = await verifyRunOutput({
      config,
      finalAnswer: "Published: https://app.preview.agent-paste.sh/al/ABC123#token",
      outputDir,
      text: "Published: https://app.preview.agent-paste.sh/al/ABC123#token",
    });

    expect(result.passed).toBe(true);
    expect(result.warnings).toEqual(["production_artifact_url_detected"]);
    expect(result.production_artifact_url_detected).toBe(true);
    expect(result.production_url_details.artifact).toEqual(["https://app.agent-paste.sh/al/prod#token"]);
  });

  it("does not warn on transcript or artifact secret-looking values", async () => {
    const config = await loadConfig("config.smoke.yaml");
    const outputDir = await mkdtemp(join(tmpdir(), "agent-paste-eval-verifier-"));
    tempDirs.push(outputDir);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("OPENROUTER_API_KEY=sk-or-v1-artifact", { status: 200 })),
    );

    const result = await verifyRunOutput({
      config,
      finalAnswer: "Published: https://app.preview.agent-paste.sh/al/ABC123#token",
      outputDir,
      text: "Published: https://app.preview.agent-paste.sh/al/ABC123#token\nOPENROUTER_API_KEY=sk-or-v1-transcript",
    });

    expect(result.passed).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("fails when only tool output contains the handoff URL", async () => {
    const config = await loadConfig("config.smoke.yaml");
    const outputDir = await mkdtemp(join(tmpdir(), "agent-paste-eval-verifier-"));
    tempDirs.push(outputDir);
    const fetchSpy = vi.fn(async () => new Response("<html>ok</html>", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await verifyRunOutput({
      config,
      finalAnswer: "",
      outputDir,
      text: "tool output: https://app.preview.agent-paste.sh/al/ABC123#token",
    });

    expect(result.passed).toBe(false);
    expect(result.errors).toEqual(["missing_final_answer_unlisted_url"]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("strips markdown and event stream noise from access-link fragments", async () => {
    const config = await loadConfig("config.smoke.yaml");
    const outputDir = await mkdtemp(join(tmpdir(), "agent-paste-eval-verifier-"));
    tempDirs.push(outputDir);
    const fetchSpy = vi.fn(async () => new Response("<html>ok</html>", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await verifyRunOutput({
      config,
      finalAnswer: [
        "**https://app.preview.agent-paste.sh/al/ABC123#AQEabc_DEF-123**",
        "https://app.preview.agent-paste.sh/al/XYZ789#AQEabc_DEF-789[event:thread.started",
      ].join("\n"),
      outputDir,
      text: [
        "**https://app.preview.agent-paste.sh/al/ABC123#AQEabc_DEF-123**",
        "https://app.preview.agent-paste.sh/al/XYZ789#AQEabc_DEF-789[event:thread.started",
      ].join("\n"),
    });

    expect(result.passed).toBe(true);
    expect(result.unlisted_url).toBe("https://app.preview.agent-paste.sh/al/ABC123#AQEabc_DEF-123");
    expect(fetchSpy).toHaveBeenCalledWith("https://app.preview.agent-paste.sh/al/ABC123#AQEabc_DEF-123", {
      redirect: "follow",
      signal: expect.any(AbortSignal),
    });
  });
});
