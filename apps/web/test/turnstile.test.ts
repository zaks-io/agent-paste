import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  env: {
    AGENT_PASTE_ENV: "dev" as string,
    TURNSTILE_SITE_KEY: "site-key",
    TURNSTILE_SECRET_KEY: undefined as string | undefined,
  },
}));

vi.mock("../src/server/runtime", () => ({
  getWebEnv: () => runtime.env,
}));

import { LOCAL_TURNSTILE_BYPASS_TOKEN, turnstileSiteKey, verifyTurnstileToken } from "../src/server/turnstile";

describe("turnstile", () => {
  beforeEach(() => {
    runtime.env = {
      AGENT_PASTE_ENV: "dev",
      TURNSTILE_SITE_KEY: " site-key ",
      TURNSTILE_SECRET_KEY: undefined,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns a trimmed site key when configured", () => {
    expect(turnstileSiteKey()).toBe("site-key");
  });

  it("returns null when the site key is blank", () => {
    runtime.env.TURNSTILE_SITE_KEY = "   ";
    expect(turnstileSiteKey()).toBeNull();
  });

  it("rejects empty tokens", async () => {
    await expect(verifyTurnstileToken("   ")).resolves.toBe(false);
  });

  it("accepts the local bypass token in dev when no secret is configured", async () => {
    await expect(verifyTurnstileToken(LOCAL_TURNSTILE_BYPASS_TOKEN)).resolves.toBe(true);
  });

  it("rejects non-bypass tokens in dev when no secret is configured", async () => {
    await expect(verifyTurnstileToken("not-a-bypass-token")).resolves.toBe(false);
  });

  it("rejects bypass tokens outside dev when no secret is configured", async () => {
    runtime.env.AGENT_PASTE_ENV = "prod";
    await expect(verifyTurnstileToken(LOCAL_TURNSTILE_BYPASS_TOKEN)).resolves.toBe(false);
  });

  it("verifies tokens against Cloudflare when a secret is configured", async () => {
    runtime.env.TURNSTILE_SECRET_KEY = " turnstile-secret ";
    const fetchMock = vi.fn(async () => Response.json({ success: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(verifyTurnstileToken(" response-token ")).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      expect.objectContaining({ method: "POST", signal: expect.any(AbortSignal) }),
    );
  });

  it("returns false when Cloudflare verification fails", async () => {
    runtime.env.TURNSTILE_SECRET_KEY = "turnstile-secret";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ success: false })),
    );

    await expect(verifyTurnstileToken("bad-token")).resolves.toBe(false);
  });

  it("returns false when the Cloudflare request is not ok", async () => {
    runtime.env.TURNSTILE_SECRET_KEY = "turnstile-secret";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 })),
    );

    await expect(verifyTurnstileToken("bad-token")).resolves.toBe(false);
  });

  it("returns false when Cloudflare verification throws", async () => {
    runtime.env.TURNSTILE_SECRET_KEY = "turnstile-secret";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    await expect(verifyTurnstileToken("bad-token")).resolves.toBe(false);
  });
});
