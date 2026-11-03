import { describe, expect, it } from "vitest";
import { hostedTransferEndpoints, hostedTransferRequestKind, transferEndpoints } from "./transfer-endpoints.mjs";

const origin = (role, scope = "pr-686", account = "isaac-a46") =>
  `https://agent-paste-${role}-${scope}.${account}.workers.dev`;
const env = {
  PR_NUMBER: "686",
  AGENT_PASTE_PR_API_URL: origin("api"),
  AGENT_PASTE_PR_UPLOAD_URL: origin("upload"),
  AGENT_PASTE_PR_CONTENT_URL: origin("content"),
};

describe("transfer endpoint isolation", () => {
  it("accepts loopback and matching standing previews or PR Workers", () => {
    expect(transferEndpoints("http://127.0.0.1:8100", "http://localhost:8101").api).toBe("http://127.0.0.1:8100");
    expect(transferEndpoints("http://[::1]:8100", "http://[::1]:8101").upload).toBe("http://[::1]:8101");
    expect(transferEndpoints(origin("api", "preview"), origin("upload", "preview")).api).toBe(origin("api", "preview"));
    expect(hostedTransferEndpoints(env)).toEqual({
      api: origin("api"),
      upload: origin("upload"),
      content: origin("content"),
      pr: "686",
    });
  });

  it.each([
    ["https://api.agent-paste.sh", "https://upload.agent-paste.sh"],
    ["https://preview.attacker.test", "https://preview.attacker.test"],
    [origin("api"), origin("upload", "pr-687")],
    [origin("api"), origin("upload", "pr-686", "other-account")],
    [origin("api"), origin("upload", "preview")],
    [origin("api"), "http://localhost:8101"],
    [origin("api").replace("https:", "http:"), origin("upload")],
    [`${origin("api")}:8443`, origin("upload")],
    [`${origin("api")}/v1`, origin("upload")],
    [`${origin("api")}?secret=private`, origin("upload")],
    [`${origin("api")}#private`, origin("upload")],
    [origin("api").replace("https://", "https://user:private@"), origin("upload")],
    [`${origin("api")}.attacker.test`, origin("upload")],
    [undefined, undefined],
  ])("rejects unsafe or mixed endpoint pairs", (api, upload) => {
    expect(() => transferEndpoints(api, upload)).toThrow();
  });

  it.each([
    { PR_NUMBER: "687" },
    { PR_NUMBER: "0" },
    { AGENT_PASTE_PR_CONTENT_URL: origin("content", "pr-687") },
    { AGENT_PASTE_PR_CONTENT_URL: origin("content", "pr-686", "other-account") },
    { AGENT_PASTE_PR_CONTENT_URL: "https://usercontent.agent-paste.link" },
    { AGENT_PASTE_PR_API_URL: origin("api", "preview"), AGENT_PASTE_PR_UPLOAD_URL: origin("upload", "preview") },
  ])("requires all hosted endpoints to match the explicit PR", (override) => {
    expect(() => hostedTransferEndpoints({ ...env, ...override })).toThrow();
  });
});

describe("PR content routing", () => {
  const config = hostedTransferEndpoints(env);
  const capability = "0123456789abcdef0123456789abcdef";
  it("accepts only this PR's capability domain and Content Worker grants", () => {
    expect(hostedTransferRequestKind(config, `https://${capability}-pr-686.agent-paste.link/large.bin`)).toBe(
      "capability",
    );
    expect(hostedTransferRequestKind(config, "https://00000-00000-00000-00000-pr-686.agent-paste.link/")).toBe(
      "capability",
    );
    expect(hostedTransferRequestKind(config, `${origin("content")}/v/private-token/large.bin`)).toBe("content");
  });
  it.each([
    `https://${capability}.agent-paste.link/`,
    `https://${capability}-preview.agent-paste.link/`,
    `https://${capability}-pr-687.agent-paste.link/`,
    `https://${capability}-pr-686.agent-paste.link.attacker.test/`,
    `${origin("content", "pr-687")}/v/private-token/file.bin`,
    `${origin("content")}/large.bin`,
    `${origin("api")}/__test__/delete-artifact`,
    "https://usercontent.agent-paste.link/v/private-token/file.bin",
    "https://invalid-pr-686.agent-paste.link/",
  ])("rejects content and harness requests outside this soak", (url) => {
    expect(() => hostedTransferRequestKind(config, url)).toThrow();
  });
});
