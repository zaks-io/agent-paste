import { describe, expect, it, vi } from "vitest";
import { checkPrPreviewCapacity, parseHyperdriveList, parsePrPreviewNumber } from "./check-pr-preview-capacity.mjs";

describe("checkPrPreviewCapacity", () => {
  it("allows reruns when the target PR Hyperdrive already exists at capacity", async () => {
    const run = vi.fn(async () => ({
      code: 0,
      stdout: hyperdriveList(["agent-paste-db-pr-115", "agent-paste-db-pr-116"]),
      stderr: "",
    }));
    const fetch = vi.fn();

    await expect(
      checkPrPreviewCapacity({ prNumber: "115", hyperdriveLimit: 2 }, { run, fetch, log: () => {} }),
    ).resolves.toMatchObject({
      allowed: true,
      targetName: "agent-paste-db-pr-115",
      total: 2,
      previewTotal: 2,
      hyperdriveLimit: 2,
    });

    expect(fetch).not.toHaveBeenCalled();
  });

  it("allows new previews while Hyperdrive capacity is available", async () => {
    const run = vi.fn(async () => ({
      code: 0,
      stdout: hyperdriveList(["agent-paste-db-pr-115"]),
      stderr: "",
    }));

    await expect(
      checkPrPreviewCapacity({ prNumber: 116, hyperdriveLimit: 2 }, { run, log: () => {} }),
    ).resolves.toEqual({
      allowed: true,
      targetName: "agent-paste-db-pr-116",
      total: 1,
      previewTotal: 1,
      hyperdriveLimit: 2,
    });
  });

  it("counts non-PR Hyperdrive configs before creating a new preview", async () => {
    const run = vi.fn(async () => ({
      code: 0,
      stdout: hyperdriveList(["agent-paste-db-pr-115", "agent-paste-db-preview"]),
      stderr: "",
    }));
    const fetch = vi.fn().mockResolvedValueOnce(jsonResponse({ state: "open" }));

    await expect(
      checkPrPreviewCapacity(
        {
          prNumber: 116,
          hyperdriveLimit: 2,
          github: {
            apiUrl: "https://api.github.test",
            repository: "zaks-io/agent-paste",
            token: "test-token",
          },
        },
        { run, fetch, log: () => {} },
      ),
    ).rejects.toThrow("Hyperdrive capacity is exhausted (2/2)");
  });

  it("fails before Neon branch creation when a new preview would exceed capacity", async () => {
    const run = vi.fn(async () => ({
      code: 0,
      stdout: hyperdriveList(["agent-paste-db-pr-108", "agent-paste-db-pr-115"]),
      stderr: "",
    }));
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ state: "closed" }))
      .mockResolvedValueOnce(jsonResponse({ state: "open" }));

    await expect(
      checkPrPreviewCapacity(
        {
          prNumber: 116,
          hyperdriveLimit: 2,
          github: {
            apiUrl: "https://api.github.test",
            repository: "zaks-io/agent-paste",
            token: "test-token",
          },
        },
        { run, fetch, log: () => {} },
      ),
    ).rejects.toThrow(/agent-paste-db-pr-108 \(closed\)/);

    expect(fetch).toHaveBeenCalledWith("https://api.github.test/repos/zaks-io/agent-paste/pulls/108", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer test-token",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  });

  it("surfaces wrangler list failures", async () => {
    const run = vi.fn(async () => ({ code: 1, stdout: "", stderr: "not authenticated" }));

    await expect(
      checkPrPreviewCapacity({ prNumber: 116, hyperdriveLimit: 25 }, { run, log: () => {} }),
    ).rejects.toThrow("not authenticated");
  });

  it("rejects invalid numeric inputs", async () => {
    const run = vi.fn();

    await expect(checkPrPreviewCapacity({ prNumber: "0", hyperdriveLimit: 25 }, { run })).rejects.toThrow("PR_NUMBER");
    await expect(checkPrPreviewCapacity({ prNumber: 116, hyperdriveLimit: "0" }, { run })).rejects.toThrow(
      "AGENT_PASTE_HYPERDRIVE_LIMIT",
    );
  });
});

describe("parseHyperdriveList", () => {
  it("parses PR-scoped Hyperdrive configs and ignores unrelated names", () => {
    expect(
      parseHyperdriveList(
        [
          "11111111111111111111111111111111 agent-paste-db-preview",
          "22222222222222222222222222222222 agent-paste-db-pr-115",
          "33333333333333333333333333333333 other-config",
        ].join("\n"),
      ),
    ).toEqual([
      { id: "11111111111111111111111111111111", name: "agent-paste-db-preview" },
      { id: "22222222222222222222222222222222", name: "agent-paste-db-pr-115" },
      { id: "33333333333333333333333333333333", name: "other-config" },
    ]);
  });
});

describe("parsePrPreviewNumber", () => {
  it("extracts only positive integer PR numbers from PR preview Hyperdrive names", () => {
    expect(parsePrPreviewNumber("agent-paste-db-pr-115")).toBe("115");
    expect(parsePrPreviewNumber("agent-paste-db-preview")).toBeNull();
    expect(parsePrPreviewNumber("agent-paste-db-pr-0")).toBeNull();
  });
});

function hyperdriveList(names) {
  return names.map((name, index) => `${String(index + 1).repeat(32)} ${name}`).join("\n");
}

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload));
}
