import { describe, expect, it } from "vitest";
import type { Env } from "./env.js";
import { frameAncestorsForEnv } from "./frame-ancestors.js";

function env(agentPasteEnv?: string): Env {
  return { AGENT_PASTE_ENV: agentPasteEnv } as Env;
}

describe("frameAncestorsForEnv", () => {
  it("allows the production dashboard in production", () => {
    expect(frameAncestorsForEnv(env("production"))).toEqual(["https://app.agent-paste.sh"]);
  });

  it("allows the preview dashboard in preview", () => {
    expect(frameAncestorsForEnv(env("preview"))).toEqual(["https://app.preview.agent-paste.sh"]);
  });

  it("allows no framers for dev or an unset env", () => {
    expect(frameAncestorsForEnv(env("dev"))).toEqual([]);
    expect(frameAncestorsForEnv(env())).toEqual([]);
  });
});
