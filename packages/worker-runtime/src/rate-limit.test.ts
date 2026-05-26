import { afterEach, describe, expect, it, vi } from "vitest";
import type { Principal } from "./principal.js";
import { applyRateLimit } from "./rate-limit.js";

const actorContract = { rateLimit: "actor" } as Parameters<typeof applyRateLimit>[0];
const artifactContract = { rateLimit: "artifact" } as Parameters<typeof applyRateLimit>[0];
const noneContract = { rateLimit: "none" } as Parameters<typeof applyRateLimit>[0];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("applyRateLimit", () => {
  it("allows routes without rate limits", async () => {
    await expect(applyRateLimit(noneContract, apiKeyPrincipal(), undefined)).resolves.toEqual({ ok: true });
  });

  it("checks actor and workspace buckets for API-key principals", async () => {
    const actor = vi.fn().mockResolvedValue({ success: true });
    const workspace = vi.fn().mockResolvedValue({ success: true });

    await expect(
      applyRateLimit(actorContract, apiKeyPrincipal(), { actor: { limit: actor }, workspace: { limit: workspace } }),
    ).resolves.toEqual({ ok: true });

    expect(actor).toHaveBeenCalledWith({ key: "workspace_1:actor_1" });
    expect(workspace).toHaveBeenCalledWith({ key: "workspace_1" });
  });

  it("returns actor and workspace rate-limit errors", async () => {
    await expect(
      applyRateLimit(actorContract, apiKeyPrincipal(), {
        actor: { limit: vi.fn().mockResolvedValue({ success: false }) },
      }),
    ).resolves.toEqual({ ok: false, code: "rate_limited_actor", retryAfter: "60" });

    await expect(
      applyRateLimit(actorContract, apiKeyPrincipal(), {
        actor: { limit: vi.fn().mockResolvedValue({ success: true }) },
        workspace: { limit: vi.fn().mockResolvedValue({ success: false }) },
      }),
    ).resolves.toEqual({ ok: false, code: "rate_limited_workspace", retryAfter: "10" });
  });

  it("rate-limits platform operators by actor only", async () => {
    const actor = vi.fn().mockResolvedValue({ success: false });
    const principal: Principal = { kind: "operator", actor: { type: "platform", id: "operator@example.com" } };

    await expect(applyRateLimit(actorContract, principal, { actor: { limit: actor } })).resolves.toEqual({
      ok: false,
      code: "rate_limited_actor",
      retryAfter: "60",
    });
    expect(actor).toHaveBeenCalledWith({ key: "platform:operator@example.com" });
  });

  it("requires an actor for actor-scoped WorkOS principals", async () => {
    await expect(applyRateLimit(actorContract, { kind: "workos_access_token", identity: {} }, {})).resolves.toEqual({
      ok: false,
      code: "not_authenticated",
      retryAfter: "60",
    });
  });

  it("checks artifact buckets for signed content tokens", async () => {
    const artifact = vi.fn().mockResolvedValue({ success: false });

    await expect(
      applyRateLimit(
        artifactContract,
        { kind: "signed_content_token", payload: { artifact_id: "artifact_1" } },
        { artifact: { limit: artifact } },
      ),
    ).resolves.toEqual({ ok: false, code: "rate_limited_artifact", retryAfter: "60" });
    expect(artifact).toHaveBeenCalledWith({ key: "artifact_1" });
  });

  it("checks artifact buckets for signed public Agent View tokens", async () => {
    const artifact = vi.fn().mockResolvedValue({ success: false });

    await expect(
      applyRateLimit(
        artifactContract,
        {
          kind: "signed_agent_view_token",
          payload: { artifact_id: "art_1", revision_id: "rev_1", exp: 1 },
        },
        { artifact: { limit: artifact } },
      ),
    ).resolves.toEqual({ ok: false, code: "rate_limited_artifact", retryAfter: "60" });
    expect(artifact).toHaveBeenCalledWith({ key: "art_1" });
  });

  it("fails open when bindings are missing or throw", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = vi.fn().mockRejectedValue(new Error("limit unavailable"));

    await expect(applyRateLimit(actorContract, apiKeyPrincipal(), undefined)).resolves.toEqual({ ok: true });
    await expect(applyRateLimit(actorContract, apiKeyPrincipal(), { actor: { limit: failing } })).resolves.toEqual({
      ok: true,
    });
    await expect(
      applyRateLimit(artifactContract, { kind: "signed_content_token", payload: null }, {}),
    ).resolves.toEqual({ ok: true });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Rate limit actor binding failed"), expect.any(Error));
  });
});

function apiKeyPrincipal(): Principal {
  return { kind: "api_key", actor: { type: "api_key", id: "actor_1", workspace_id: "workspace_1" } };
}
