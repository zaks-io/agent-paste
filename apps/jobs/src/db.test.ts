import { describe, expect, it, vi } from "vitest";
import { createHyperdriveExecutor } from "@agent-paste/db";
import { resolveSqlExecutor } from "./db.js";

vi.mock("@agent-paste/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agent-paste/db")>();
  return {
    ...actual,
    createHyperdriveExecutor: vi.fn(() => ({
      query: vi.fn(),
      transaction: vi.fn(),
    })),
  };
});

describe("resolveSqlExecutor", () => {
  it("uses a local executor only when query and transaction are both present", () => {
    vi.mocked(createHyperdriveExecutor).mockClear();
    const local = {
      query: vi.fn(),
      transaction: vi.fn(),
    };
    expect(resolveSqlExecutor({ DB: local })).toBe(local);
    expect(createHyperdriveExecutor).not.toHaveBeenCalled();
  });

  it("falls back to Hyperdrive when the binding is incomplete", () => {
    vi.mocked(createHyperdriveExecutor).mockClear();
    const hyperdrive = { connectionString: "postgres://example" };
    resolveSqlExecutor({ DB: { query: vi.fn() } });
    resolveSqlExecutor({ DB: hyperdrive });
    expect(createHyperdriveExecutor).toHaveBeenCalledTimes(2);
    expect(createHyperdriveExecutor).toHaveBeenLastCalledWith(hyperdrive);
  });
});
