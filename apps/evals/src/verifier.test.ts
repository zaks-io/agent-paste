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
      outputDir,
      text: ["Published: https://app.preview.agent-paste.sh/al/ABC123#token", "Docs: https://agent-paste.sh/docs"].join(
        "\n",
      ),
    });

    expect(result.passed).toBe(true);
    expect(result.status).toBe(200);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.production_url_detected).toBe(true);
    expect(result.production_doc_url_detected).toBe(true);
    expect(result.production_handoff_url_detected).toBe(false);
  });

  it("fails production handoff URLs for a preview eval", async () => {
    const config = await loadConfig("config.smoke.yaml");
    const outputDir = await mkdtemp(join(tmpdir(), "agent-paste-eval-verifier-"));
    const fetchSpy = vi.fn(async () => new Response("<html>ok</html>", { status: 200 }));
    tempDirs.push(outputDir);
    vi.stubGlobal("fetch", fetchSpy);

    const result = await verifyRunOutput({
      config,
      outputDir,
      text: "Published: https://app.agent-paste.sh/al/ABC123#token",
    });

    expect(result.passed).toBe(false);
    expect(result.errors).toEqual(["wrong_environment_url:app.agent-paste.sh"]);
    expect(result.warnings).toEqual(["production_handoff_url_detected"]);
    expect(result.production_handoff_url_detected).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("records production-looking non-handoff URLs without warning", async () => {
    const config = await loadConfig("config.smoke.yaml");
    const outputDir = await mkdtemp(join(tmpdir(), "agent-paste-eval-verifier-"));
    tempDirs.push(outputDir);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>ok</html>", { status: 200 })),
    );

    const result = await verifyRunOutput({
      config,
      outputDir,
      text: [
        "Published: https://app.preview.agent-paste.sh/al/ABC123#token",
        "Example: https://api.agent-paste.sh/auth.md",
      ].join("\n"),
    });

    expect(result.passed).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.production_url_detected).toBe(true);
    expect(result.production_url_details.other).toEqual(["https://api.agent-paste.sh/auth.md"]);
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
      outputDir,
      text: "Published: https://app.preview.agent-paste.sh/al/ABC123#token",
    });

    expect(result.passed).toBe(true);
    expect(result.warnings).toEqual(["production_artifact_url_detected"]);
    expect(result.production_artifact_url_detected).toBe(true);
    expect(result.production_url_details.artifact).toEqual(["https://app.agent-paste.sh/al/prod#token"]);
  });

  it("warns when the transcript or artifact contains secrets", async () => {
    const config = await loadConfig("config.smoke.yaml");
    const outputDir = await mkdtemp(join(tmpdir(), "agent-paste-eval-verifier-"));
    tempDirs.push(outputDir);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("OPENROUTER_API_KEY=sk-or-v1-artifact", { status: 200 })),
    );

    const result = await verifyRunOutput({
      config,
      outputDir,
      text: "Published: https://app.preview.agent-paste.sh/al/ABC123#token\nOPENROUTER_API_KEY=sk-or-v1-transcript",
    });

    expect(result.passed).toBe(true);
    expect(result.warnings).toEqual(["secret_detected:transcript", "secret_detected:artifact"]);
    expect(result.secret_detected).toBe(true);
    expect(result.secret_sources).toEqual(
      expect.arrayContaining(["transcript:secret_assignment", "artifact:secret_assignment"]),
    );
  });
});
