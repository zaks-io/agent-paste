import { describe, expect, it, vi } from "vitest";
import { cleanupPrPreview, parseHyperdriveList } from "./cleanup-pr-preview.mjs";

describe("cleanupPrPreview", () => {
  it("detaches queue consumers before deleting the jobs Worker and queues", async () => {
    const calls = [];
    const deletedWorkers = [];
    const run = vi.fn(async (_command, args) => {
      calls.push(args);
      if (args.join(" ") === "exec wrangler hyperdrive list") {
        return {
          code: 0,
          stdout:
            "│ 20f16e960551427e8ef8c709143c7934 │ agent-paste-db-pr-114 │ app_role │ ep-flat-dew.example │ 5432 │ PostgreSQL │ neondb │",
          stderr: "",
        };
      }
      return { code: 0, stdout: "", stderr: "" };
    });

    const fetch = vi.fn(async (url, init) => {
      deletedWorkers.push({ url: String(url), method: init?.method });
      return jsonResponse({ success: true });
    });

    await cleanupPrPreview("114", {
      run,
      fetch,
      cloudflare: cloudflareOptions,
      log: () => {},
      sleep: async () => {},
    });

    expect(calls.slice(0, 4)).toEqual([
      ["exec", "wrangler", "queues", "consumer", "remove", "byte-purge-preview-pr-114", "agent-paste-jobs-pr-114"],
      ["exec", "wrangler", "queues", "consumer", "remove", "safety-scan-preview-pr-114", "agent-paste-jobs-pr-114"],
      ["exec", "wrangler", "queues", "consumer", "remove", "bundle-generate-preview-pr-114", "agent-paste-jobs-pr-114"],
      [
        "exec",
        "wrangler",
        "queues",
        "consumer",
        "remove",
        "bundle-generate-dlq-preview-pr-114",
        "agent-paste-jobs-pr-114",
      ],
    ]);

    const firstQueueDeleteIndex = calls.findIndex(
      (args) => args.join(" ") === "exec wrangler queues delete byte-purge-preview-pr-114",
    );
    const hyperdriveDeleteIndex = calls.findIndex(
      (args) => args.join(" ") === "exec wrangler hyperdrive delete 20f16e960551427e8ef8c709143c7934",
    );

    expect(deletedWorkers).toHaveLength(6);
    expect(deletedWorkers).toContainEqual({
      url: "https://api.cloudflare.test/client/v4/accounts/test-account/workers/scripts/agent-paste-jobs-pr-114",
      method: "DELETE",
    });
    expect(firstQueueDeleteIndex).toBeGreaterThan(3);
    expect(hyperdriveDeleteIndex).toBeGreaterThan(firstQueueDeleteIndex);
  });

  it("continues through later resource classes and reports all cleanup failures", async () => {
    const run = vi.fn(async (_command, args) => {
      if (args.join(" ") === "exec wrangler queues consumer remove byte-purge-preview-pr-114 agent-paste-jobs-pr-114") {
        return { code: 1, stdout: "", stderr: "transient Cloudflare failure" };
      }
      if (args.join(" ") === "exec wrangler queues delete safety-scan-preview-pr-114") {
        return { code: 1, stdout: "", stderr: "delete failed" };
      }
      if (args.join(" ") === "exec wrangler hyperdrive list") {
        return {
          code: 0,
          stdout:
            "│ 20f16e960551427e8ef8c709143c7934 │ agent-paste-db-pr-114 │ app_role │ ep-flat-dew.example │ 5432 │ PostgreSQL │ neondb │",
          stderr: "",
        };
      }
      return { code: 0, stdout: "", stderr: "" };
    });

    await expect(
      cleanupPrPreview("114", {
        run,
        fetch: async () => jsonResponse({ success: true }),
        cloudflare: cloudflareOptions,
        log: () => {},
        sleep: async () => {},
      }),
    ).rejects.toThrow(
      /detach agent-paste-jobs-pr-114 from byte-purge-preview-pr-114:[\s\S]*delete queue safety-scan-preview-pr-114/,
    );
    expect(run).toHaveBeenCalledWith(
      "pnpm",
      ["exec", "wrangler", "hyperdrive", "delete", "20f16e960551427e8ef8c709143c7934"],
      {
        allowFailure: true,
        quiet: true,
      },
    );
    expect(run).toHaveBeenCalledWith("pnpm", ["exec", "wrangler", "hyperdrive", "list"], {
      allowFailure: true,
      quiet: true,
    });
  });

  it("reports a scoped Worker API failure and continues deleting other Workers", async () => {
    const run = vi.fn(async (_command, args) => {
      if (args.join(" ") === "exec wrangler hyperdrive list") {
        return { code: 0, stdout: "", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    });
    const fetch = vi.fn(async (url) =>
      String(url).includes("agent-paste-api-pr-114")
        ? jsonResponse({ success: false }, { status: 403 })
        : jsonResponse({ success: true }),
    );

    await expect(
      cleanupPrPreview("114", { run, fetch, cloudflare: cloudflareOptions, log: () => {}, sleep: async () => {} }),
    ).rejects.toThrow("delete worker agent-paste-api-pr-114: Cloudflare Worker delete failed: 403");
    expect(fetch).toHaveBeenCalledTimes(6);
  });
});

describe("parseHyperdriveList", () => {
  it("parses table rows by id and agent-paste database name", () => {
    expect(
      parseHyperdriveList("│ 3cb90e512abe4320b5abc070af060049 │ agent-paste-db-pr-100 │ app_role │ ep-empty.example │"),
    ).toEqual([{ id: "3cb90e512abe4320b5abc070af060049", name: "agent-paste-db-pr-100" }]);
  });
});

const cloudflareOptions = {
  apiHost: "https://api.cloudflare.test/client/v4",
  accountId: "test-account",
  apiToken: "test-token",
};

function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload), { status: init.status ?? 200 });
}
