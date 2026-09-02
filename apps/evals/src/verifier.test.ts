import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config";
import { verifyRunOutput } from "./verifier";

const previewUrl = "https://0123456789abcdef0123456789abcdef-preview.agent-paste.link/";
const productionUrl = "https://0123456789abcdef0123456789abcdef.agent-paste.link/";
const tempDirs: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

async function setup() {
  const config = await loadConfig("config.smoke.yaml");
  const outputDir = await mkdtemp(join(tmpdir(), "agent-paste-eval-verifier-"));
  tempDirs.push(outputDir);
  return { config, outputDir };
}

describe("verifyRunOutput", () => {
  it("fetches the preview artifact URL handed to the user", async () => {
    const { config, outputDir } = await setup();
    const fetchSpy = vi.fn(async () => new Response("<html>ok</html>", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await verifyRunOutput({
      config,
      finalAnswer: `Published: ${previewUrl}`,
      outputDir,
      text: `Published: ${previewUrl}\nDocs: https://agent-paste.sh/docs`,
    });

    expect(result.passed).toBe(true);
    expect(result.artifact_url).toBe(previewUrl);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledWith(previewUrl, {
      redirect: "follow",
      signal: expect.any(AbortSignal),
    });
  });

  it("rejects a production artifact URL during a preview eval", async () => {
    const { config, outputDir } = await setup();
    const fetchSpy = vi.fn(async () => new Response("<html>ok</html>", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await verifyRunOutput({
      config,
      finalAnswer: `Published: ${productionUrl}`,
      outputDir,
      text: `Published: ${productionUrl}`,
    });

    expect(result.passed).toBe(false);
    expect(result.errors).toEqual(["wrong_environment_url:0123456789abcdef0123456789abcdef.agent-paste.link"]);
    expect(result.warnings).toEqual(["production_handoff_url_detected"]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("requires the artifact URL in the final answer", async () => {
    const { config, outputDir } = await setup();
    const fetchSpy = vi.fn(async () => new Response("<html>ok</html>", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await verifyRunOutput({
      config,
      finalAnswer: "Published successfully.",
      outputDir,
      text: `tool output: ${previewUrl}`,
    });

    expect(result.passed).toBe(false);
    expect(result.errors).toEqual(["missing_final_answer_artifact_url"]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("warns when the fetched artifact contains a production artifact URL", async () => {
    const { config, outputDir } = await setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(`<a href="${productionUrl}">bad</a>`, { status: 200 })),
    );

    const result = await verifyRunOutput({
      config,
      finalAnswer: `Published: ${previewUrl}`,
      outputDir,
      text: `Published: ${previewUrl}`,
    });

    expect(result.passed).toBe(true);
    expect(result.warnings).toEqual(["production_artifact_url_detected"]);
    expect(result.production_artifact_url_detected).toBe(true);
    expect(result.production_url_details.artifact).toEqual([productionUrl]);
  });
});
