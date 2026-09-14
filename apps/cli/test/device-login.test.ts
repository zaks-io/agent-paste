import { afterEach, describe, expect, it, vi } from "vitest";
import type { LoginConfig } from "../src/config.js";
import type { CredentialStore } from "../src/credentials.js";
import { loginWithDeviceCode } from "../src/device-login.js";
import { login } from "../src/login.js";

const config: LoginConfig = {
  clientId: "client_real",
  authorizeUrl: "https://tenant.authkit.app/oauth2/authorize",
  deviceAuthorizationUrl: "https://tenant.authkit.app/oauth2/device_authorization",
  tokenUrl: "https://tenant.authkit.app/oauth2/token",
  apiBaseUrl: "https://api.test",
  loginPort: 0,
};

const authorization = {
  device_code: "device_secret",
  user_code: "BCDF-GHJK",
  verification_uri: "https://tenant.authkit.app/device",
  verification_uri_complete: "https://tenant.authkit.app/device?user_code=BCDF-GHJK",
  expires_in: 60,
};

afterEach(() => {
  vi.useRealTimers();
});

function flow(responses: Response[], overrides: { expiresIn?: number; interval?: number } = {}) {
  let now = 0;
  const sleeps: number[] = [];
  const logs: string[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/oauth2/device_authorization")) {
      return Response.json({
        ...authorization,
        expires_in: overrides.expiresIn ?? authorization.expires_in,
        ...(overrides.interval === undefined ? {} : { interval: overrides.interval }),
      });
    }
    const response = responses.shift();
    if (!response) throw new Error("unexpected token poll");
    return response;
  });
  return {
    deps: {
      config,
      fetch: fetchImpl as unknown as typeof fetch,
      log: (message: string) => logs.push(message),
      now: () => now,
      sleep: async (milliseconds: number) => {
        sleeps.push(milliseconds);
        now += milliseconds;
      },
    },
    fetchImpl,
    logs,
    sleeps,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

describe("device login", () => {
  it("rejects polling intervals that overflow the runtime timer", async () => {
    const harness = flow([], { interval: 2_147_484, expiresIn: 10_000_000 });

    await expect(loginWithDeviceCode(harness.deps)).rejects.toThrow(/timer limit/);
    expect(harness.sleeps).toEqual([]);
    expect(harness.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects slow_down when it pushes the polling interval beyond the timer limit", async () => {
    const harness = flow([Response.json({ error: "slow_down" }, { status: 400 })], {
      interval: 2_147_483,
      expiresIn: 10_000_000,
    });

    await expect(loginWithDeviceCode(harness.deps)).rejects.toThrow(/timer limit/);
    expect(harness.sleeps).toEqual([2_147_483_000]);
    expect(harness.fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("uses the RFC default interval and adds five seconds after slow_down", async () => {
    const harness = flow([
      Response.json({ error: "slow_down" }, { status: 400 }),
      Response.json({ access_token: "access_token" }),
    ]);

    await expect(loginWithDeviceCode(harness.deps)).resolves.toEqual({ access_token: "access_token" });
    expect(harness.sleeps).toEqual([5_000, 10_000]);
  });

  it("counts time spent in token requests against device-code expiry", async () => {
    const harness = flow([Response.json({ error: "authorization_pending" }, { status: 400 })], {
      expiresIn: 6,
      interval: 5,
    });
    harness.fetchImpl.mockImplementationOnce(async () =>
      Response.json({ ...authorization, expires_in: 6, interval: 5 }),
    );
    harness.fetchImpl.mockImplementationOnce(async () => {
      harness.advance(2_000);
      return Response.json({ error: "authorization_pending" }, { status: 400 });
    });

    await expect(loginWithDeviceCode(harness.deps)).rejects.toThrow(/authorization expired/);
    expect(harness.sleeps).toEqual([5_000]);
    expect(harness.fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("waits until expiry without polling faster than the provider interval", async () => {
    const harness = flow([Response.json({ error: "authorization_pending" }, { status: 400 })], {
      expiresIn: 6,
      interval: 5,
    });

    await expect(loginWithDeviceCode(harness.deps)).rejects.toThrow(/authorization expired/);
    expect(harness.sleeps).toEqual([5_000, 1_000]);
    expect(harness.fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("accepts an in-flight success after the device code expires", async () => {
    vi.useFakeTimers();
    const token = { access_token: "issued_before_expiry" };
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (fetchImpl.mock.calls.length === 1) {
        return Response.json({ ...authorization, expires_in: 6, interval: 5 });
      }
      return new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("request aborted")));
        setTimeout(() => resolve(Response.json(token)), 2_000);
      });
    });

    const result = loginWithDeviceCode({ config, fetch: fetchImpl, log: () => {} });
    const outcome = result.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(7_000);

    await expect(outcome).resolves.toEqual(token);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("stops when the user denies authorization", async () => {
    const harness = flow([Response.json({ error: "access_denied" }, { status: 400 })], { interval: 1 });

    await expect(loginWithDeviceCode(harness.deps)).rejects.toThrow("Device authorization was denied.");
    expect(harness.fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["expired_token", "Device authorization expired."],
    ["invalid_grant", "Device token request failed with status 400."],
  ])("stops on %s", async (error, message) => {
    const harness = flow([Response.json({ error }, { status: 400 })], { interval: 1 });

    await expect(loginWithDeviceCode(harness.deps)).rejects.toThrow(message);
    expect(harness.fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects an unknown OAuth error even when the response includes a token", async () => {
    const harness = flow([Response.json({ error: "provider_error", access_token: "must_not_be_used" })], {
      interval: 1,
    });

    await expect(loginWithDeviceCode(harness.deps)).rejects.toThrow("Device token request failed with status 200.");
  });

  it("rejects malformed authorization without printing provider secrets", async () => {
    const providerSecret = "provider_device_secret";
    const tokenSecret = "provider_access_token";
    const logs: string[] = [];
    const fetchImpl = vi.fn(async () =>
      Response.json({ device_code: providerSecret, access_token: tokenSecret, expires_in: "300" }),
    );

    const result = loginWithDeviceCode({
      config,
      fetch: fetchImpl as unknown as typeof fetch,
      log: (message) => logs.push(message),
      sleep: async () => {},
    });
    await expect(result).rejects.toThrow("Device authorization request returned an invalid response.");
    const visible = `${logs.join("\n")} ${await result.catch((error: unknown) => String(error))}`;
    expect(visible).not.toContain(providerSecret);
    expect(visible).not.toContain(tokenSecret);
  });

  it("caps OAuth response bodies without echoing them", async () => {
    const providerSecret = "provider_secret_marker";
    const fetchImpl = vi.fn(async () => new Response(`${providerSecret}${"x".repeat(65_536)}`));

    const result = loginWithDeviceCode({
      config,
      fetch: fetchImpl as unknown as typeof fetch,
      log: () => {},
      sleep: async () => {},
    });
    await expect(result).rejects.toThrow("Device authorization request returned an oversized response.");
    await expect(result.catch((error: unknown) => String(error))).resolves.not.toContain(providerSecret);
  });

  it("aborts a device authorization request that stalls before headers", async () => {
    vi.useFakeTimers();
    const providerSecret = "stalled_device_secret";
    const store = unusedStore();
    const fetchImpl = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error(providerSecret)));
        }),
    );

    const result = login({
      config,
      deviceCode: true,
      store,
      fetch: fetchImpl as unknown as typeof fetch,
      log: () => {},
    });
    const failure = result.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(30_000);

    const error = await failure;
    expect(error).toEqual(expect.objectContaining({ message: "Device authorization request failed." }));
    expect(String(error)).not.toContain(providerSecret);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(store.save).not.toHaveBeenCalled();
  });

  it("aborts a device authorization response body that stalls", async () => {
    vi.useFakeTimers();
    const providerSecret = "stalled_body_secret";
    const store = unusedStore();
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener("abort", () => controller.error(new Error(providerSecret)));
        },
      });
      return new Response(body);
    });

    const result = login({
      config,
      deviceCode: true,
      store,
      fetch: fetchImpl as unknown as typeof fetch,
      log: () => {},
    });
    const failure = result.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(30_000);

    const error = await failure;
    expect(error).toEqual(expect.objectContaining({ message: "Device authorization request failed." }));
    expect(String(error)).not.toContain(providerSecret);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(store.save).not.toHaveBeenCalled();
  });
});

function unusedStore(): CredentialStore & { save: ReturnType<typeof vi.fn> } {
  return {
    load: vi.fn(async () => null),
    save: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
  };
}
