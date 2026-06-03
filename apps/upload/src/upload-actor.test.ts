import { describe, expect, it } from "vitest";
import { uploadSessionActor } from "./upload-actor.js";

describe("uploadSessionActor", () => {
  it("maps api_key principals with workspace_id", () => {
    expect(
      uploadSessionActor({
        kind: "api_key",
        actor: { type: "api_key", id: "key_1", workspace_id: "ws_1", scopes: ["publish"] },
      }),
    ).toEqual({ type: "api_key", id: "key_1", workspace_id: "ws_1" });
  });

  it("rejects api keys without workspace_id", () => {
    expect(
      uploadSessionActor({
        kind: "api_key",
        actor: { type: "api_key", id: "key_1", scopes: ["publish"] },
      }),
    ).toBeNull();
  });

  it("maps member principals from WorkOS access tokens", () => {
    const member = {
      type: "member" as const,
      id: "mem_1",
      workspace_id: "ws_1",
      email: "a@b.com",
      scopes: ["publish" as const],
    };
    expect(
      uploadSessionActor({
        kind: "workos_access_token",
        actor: member,
      }),
    ).toEqual(member);
  });
});
