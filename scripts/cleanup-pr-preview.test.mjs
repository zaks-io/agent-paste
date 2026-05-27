import { describe, expect, it, vi } from "vitest";
import { cleanupPrPreview, parseHyperdriveList } from "./cleanup-pr-preview.mjs";

describe("cleanupPrPreview", () => {
  it("detaches queue consumers before deleting the jobs Worker and queues", async () => {
    const calls = [];
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

    await cleanupPrPreview("114", { run, log: () => {}, sleep: async () => {} });

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

    const jobsWorkerDeleteIndex = calls.findIndex(
      (args) => args.join(" ") === "exec wrangler delete agent-paste-jobs-pr-114 --force",
    );
    const firstQueueDeleteIndex = calls.findIndex(
      (args) => args.join(" ") === "exec wrangler queues delete byte-purge-preview-pr-114",
    );
    const hyperdriveDeleteIndex = calls.findIndex(
      (args) => args.join(" ") === "exec wrangler hyperdrive delete 20f16e960551427e8ef8c709143c7934",
    );

    expect(jobsWorkerDeleteIndex).toBeGreaterThan(3);
    expect(firstQueueDeleteIndex).toBeGreaterThan(jobsWorkerDeleteIndex);
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

    await expect(cleanupPrPreview("114", { run, log: () => {}, sleep: async () => {} })).rejects.toThrow(
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
});

describe("parseHyperdriveList", () => {
  it("parses table rows by id and agent-paste database name", () => {
    expect(
      parseHyperdriveList("│ 3cb90e512abe4320b5abc070af060049 │ agent-paste-db-pr-100 │ app_role │ ep-empty.example │"),
    ).toEqual([{ id: "3cb90e512abe4320b5abc070af060049", name: "agent-paste-db-pr-100" }]);
  });
});
