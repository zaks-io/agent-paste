import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it("enforces the PR policy in native Node and inherited child processes without logging secrets", async () => {
  const fake = `globalThis.fetch = async (_url, init) => {
    if (init.redirect !== "error") throw new Error("Redirect policy missing");
    return new Response("ok");
  };`;
  const preload = fileURLToPath(new URL("./hosted-transfer-preload.mjs", import.meta.url));
  const code = `
    import assert from "node:assert/strict";
    import { execFileSync } from "node:child_process";
    const events = [];
    process.send = (event) => events.push(event);
    await fetch(process.env.AGENT_PASTE_PR_API_URL + "/v1/whoami", {
      headers: { authorization: "Bearer " + process.env.AGENT_PASTE_API_KEY }
    });
    await fetch(process.env.AGENT_PASTE_PR_CONTENT_URL + "/v/private-token/large.bin");
    await assert.rejects(() => fetch("https://api.agent-paste.sh/v1/whoami"));
    await assert.rejects(() => fetch("https://00000-00000-00000-00000-pr-687.agent-paste.link/"));
    assert.equal(events.length, 2);
    const nested = execFileSync(process.execPath, ["--input-type=module", "-e",
      'import assert from "node:assert/strict"; await assert.rejects(() => fetch("https://api.agent-paste.sh/v1/whoami")); console.log("nested policy passed")'
    ], { encoding: "utf8" });
    assert.equal(nested.trim(), "nested policy passed");
    console.log("Native and inherited PR transfer policies passed");
  `;
  const result = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", code], {
    env: {
      ...process.env,
      PR_NUMBER: "686",
      AGENT_PASTE_API_KEY: "ap_pk_preview_native-test-only",
      AGENT_PASTE_PR_API_URL: "https://agent-paste-api-pr-686.isaac-a46.workers.dev",
      AGENT_PASTE_PR_UPLOAD_URL: "https://agent-paste-upload-pr-686.isaac-a46.workers.dev",
      AGENT_PASTE_PR_CONTENT_URL: "https://agent-paste-content-pr-686.isaac-a46.workers.dev",
      NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(fake)} --import=${preload}`,
    },
    timeout: 10_000,
  });
  expect(result.stdout.trim()).toBe("Native and inherited PR transfer policies passed");
  expect(result.stderr).toBe("");
});
