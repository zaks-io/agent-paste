import { describe, expect, it } from "vitest";
import {
  isConnectError,
  isConnectEstablishmentError,
  withConnectRetry,
  withTransactionConnectRetry,
} from "./connect-retry.js";

// postgres.js builds connection-class error messages as `write <CODE> host:port`.
function connectError(code: string): Error {
  return Object.assign(new Error(`write ${code} 10.0.0.1:5432`), { code });
}

// No real timers: inject a sleep that records waits and resolves immediately, and
// a deterministic random so backoff is reproducible. Keeps the suite non-flaky.
function harness(random = () => 1) {
  const waits: number[] = [];
  const sleep = async (ms: number) => {
    waits.push(ms);
  };
  return { waits, sleep, random };
}

describe("isConnectEstablishmentError", () => {
  it("matches the connect-time code (no statement could have run)", () => {
    expect(isConnectEstablishmentError(connectError("CONNECT_TIMEOUT"))).toBe(true);
  });

  it("matches the Hyperdrive cold-start timeout message without a code", () => {
    expect(isConnectEstablishmentError(new Error("Timed out while creating a new server connection."))).toBe(true);
  });

  it("does NOT match mid-flight drops that can fire after COMMIT", () => {
    expect(isConnectEstablishmentError(connectError("CONNECTION_CLOSED"))).toBe(false);
    expect(isConnectEstablishmentError(connectError("CONNECTION_DESTROYED"))).toBe(false);
  });
});

describe("isConnectError", () => {
  it("matches both establishment failures and mid-flight drops", () => {
    for (const code of ["CONNECT_TIMEOUT", "CONNECTION_CLOSED", "CONNECTION_DESTROYED"]) {
      expect(isConnectError(connectError(code))).toBe(true);
    }
  });

  it("does not match query, constraint, or auth errors", () => {
    expect(isConnectError(Object.assign(new Error("duplicate key"), { code: "23505" }))).toBe(false);
    expect(isConnectError(new Error("permission denied for table workspaces"))).toBe(false);
    expect(isConnectError(null)).toBe(false);
    expect(isConnectError("CONNECT_TIMEOUT")).toBe(false);
  });

  it("does not retry a query error whose message merely mentions a connection", () => {
    // A server-side error mentioning 'connection ... closed' must NOT be treated
    // as a transport drop; only postgres.js connection-class codes count.
    expect(isConnectError(new Error("the connection pool was closed by the admin"))).toBe(false);
  });
});

describe("withConnectRetry (single query)", () => {
  it("returns the result on first success without sleeping", async () => {
    const { waits, sleep, random } = harness();
    let calls = 0;
    const result = await withConnectRetry(
      async () => {
        calls += 1;
        return "ok";
      },
      { sleep, random },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(1);
    expect(waits).toEqual([]);
  });

  it("retries a cold-start connect failure and then succeeds", async () => {
    const { waits, sleep, random } = harness();
    let calls = 0;
    const result = await withConnectRetry(
      async () => {
        calls += 1;
        if (calls === 1) {
          throw connectError("CONNECT_TIMEOUT");
        }
        return "warm";
      },
      { sleep, random },
    );
    expect(result).toBe("warm");
    expect(calls).toBe(2);
    expect(waits).toHaveLength(1);
  });

  it("retries a mid-flight drop on a single query", async () => {
    const { sleep, random } = harness();
    let calls = 0;
    const result = await withConnectRetry(
      async () => {
        calls += 1;
        if (calls === 1) {
          throw connectError("CONNECTION_CLOSED");
        }
        return "ok";
      },
      { sleep, random },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("rethrows immediately on a non-connect error without retrying", async () => {
    const { waits, sleep, random } = harness();
    let calls = 0;
    await expect(
      withConnectRetry(
        async () => {
          calls += 1;
          throw Object.assign(new Error("duplicate key"), { code: "23505" });
        },
        { sleep, random },
      ),
    ).rejects.toThrow("duplicate key");
    expect(calls).toBe(1);
    expect(waits).toEqual([]);
  });

  it("gives up after the attempt budget and throws the last connect error", async () => {
    const { waits, sleep, random } = harness();
    let calls = 0;
    await expect(
      withConnectRetry(
        async () => {
          calls += 1;
          throw connectError("CONNECT_TIMEOUT");
        },
        { attempts: 3, sleep, random },
      ),
    ).rejects.toMatchObject({ code: "CONNECT_TIMEOUT" });
    expect(calls).toBe(3);
    expect(waits).toHaveLength(2);
  });

  it("backs off exponentially, capped, with full jitter", async () => {
    const { waits, sleep } = harness();
    await withConnectRetry(
      async () => {
        throw connectError("CONNECT_TIMEOUT");
      },
      { attempts: 5, baseDelayMs: 200, maxDelayMs: 600, sleep, random: () => 1 },
    ).catch(() => {});
    // 200*2^0=200, 200*2^1=400, 200*2^2=800→cap 600, 200*2^3=1600→cap 600.
    expect(waits).toEqual([200, 400, 600, 600]);
  });

  it("applies jitter as a fraction of the ceiling", async () => {
    const { waits, sleep } = harness();
    await withConnectRetry(
      async () => {
        throw connectError("CONNECT_TIMEOUT");
      },
      { attempts: 2, baseDelayMs: 200, maxDelayMs: 2000, sleep, random: () => 0.5 },
    ).catch(() => {});
    // floor(0.5 * 200) = 100 for the single backoff.
    expect(waits).toEqual([100]);
  });
});

describe("withTransactionConnectRetry", () => {
  it("retries a transaction on an establishment failure", async () => {
    const { sleep, random } = harness();
    let calls = 0;
    const result = await withTransactionConnectRetry(
      async () => {
        calls += 1;
        if (calls === 1) {
          throw connectError("CONNECT_TIMEOUT");
        }
        return "committed";
      },
      { sleep, random },
    );
    expect(result).toBe("committed");
    expect(calls).toBe(2);
  });

  it("does NOT retry a transaction on a mid-flight drop (could double-apply a commit)", async () => {
    const { waits, sleep, random } = harness();
    let calls = 0;
    await expect(
      withTransactionConnectRetry(
        async () => {
          calls += 1;
          throw connectError("CONNECTION_CLOSED");
        },
        { sleep, random },
      ),
    ).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    expect(calls).toBe(1);
    expect(waits).toEqual([]);
  });
});
