import { describe, expect, it, vi } from "vitest";
import {
  cleanupStalePrPreviews,
  discoverPrPreviewNumbers,
  parseQueuePrPreviewNumbers,
  parseWorkerNames,
} from "./cleanup-stale-pr-previews.mjs";

const github = {
  apiUrl: "https://api.github.test",
  repository: "zaks-io/agent-paste",
  token: "test-github-token",
};

const cloudflare = {
  apiHost: "https://api.cloudflare.test/client/v4",
  accountId: "test-account",
  apiToken: "test-cloudflare-token",
};

const neon = {
  apiHost: "https://console.neon.test/api/v2",
  apiKey: "test-neon-token",
  projectId: "test-project",
};

describe("cleanupStalePrPreviews", () => {
  it("cleans closed and missing PR previews discovered from Cloudflare resources", async () => {
    const run = vi.fn(async (_command, args) => {
      if (args.join(" ") === "exec wrangler hyperdrive list") {
        return {
          code: 0,
          stdout: hyperdriveList(["agent-paste-db-pr-137", "agent-paste-db-preview"]),
          stderr: "",
        };
      }
      if (args.join(" ") === "exec wrangler queues list") {
        return { code: 0, stdout: "byte-purge-preview-pr-138\nsafety-scan-preview-pr-139", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    });
    const fetch = vi.fn(async (url) => {
      if (String(url).includes("/workers/scripts")) {
        return jsonResponse({
          result: [{ id: "agent-paste-api-pr-140" }, { id: "agent-paste-web-production" }],
        });
      }
      if (String(url).endsWith("/pulls/137")) {
        return jsonResponse({ state: "closed" });
      }
      if (String(url).endsWith("/pulls/138")) {
        return textResponse("not found", { status: 404 });
      }
      if (String(url).endsWith("/pulls/140")) {
        return jsonResponse({ state: "open" });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    const cleanupPreview = vi.fn(async () => {});
    const deleteNeonBranch = vi.fn(async () => {});

    await expect(
      cleanupStalePrPreviews(
        { github, cloudflare, neon, excludePrNumber: "139" },
        { run, fetch, cleanupPreview, deleteNeonBranch, log: () => {} },
      ),
    ).resolves.toEqual({
      discovered: ["137", "138", "140"],
      stale: ["137", "138"],
      cleaned: ["137", "138"],
      dryRun: false,
    });

    expect(cleanupPreview).toHaveBeenCalledTimes(2);
    expect(cleanupPreview).toHaveBeenNthCalledWith(1, "137", expect.objectContaining({ run }));
    expect(cleanupPreview).toHaveBeenNthCalledWith(2, "138", expect.objectContaining({ run }));
    expect(deleteNeonBranch).toHaveBeenCalledTimes(2);
    expect(deleteNeonBranch).toHaveBeenNthCalledWith(1, "137", neon, expect.objectContaining({ fetch }));
  });

  it("supports dry runs without deleting resources", async () => {
    const run = vi.fn(async (_command, args) => {
      if (args.join(" ") === "exec wrangler hyperdrive list") {
        return { code: 0, stdout: hyperdriveList(["agent-paste-db-pr-137"]), stderr: "" };
      }
      if (args.join(" ") === "exec wrangler queues list") {
        return { code: 0, stdout: "", stderr: "" };
      }
      throw new Error(`Unexpected command ${args.join(" ")}`);
    });
    const fetch = vi.fn(async (url) => {
      if (String(url).endsWith("/pulls/137")) {
        return jsonResponse({ state: "closed" });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    const cleanupPreview = vi.fn(async () => {});

    await expect(
      cleanupStalePrPreviews({ github, cloudflare: {}, dryRun: true }, { run, fetch, cleanupPreview, log: () => {} }),
    ).resolves.toMatchObject({ stale: ["137"], cleaned: [], dryRun: true });
    expect(cleanupPreview).not.toHaveBeenCalled();
  });

  it("still attempts Neon branch cleanup when Cloudflare cleanup fails", async () => {
    const run = vi.fn(async (_command, args) => {
      if (args.join(" ") === "exec wrangler hyperdrive list") {
        return { code: 0, stdout: hyperdriveList(["agent-paste-db-pr-137"]), stderr: "" };
      }
      if (args.join(" ") === "exec wrangler queues list") {
        return { code: 0, stdout: "", stderr: "" };
      }
      throw new Error(`Unexpected command ${args.join(" ")}`);
    });
    const fetch = vi.fn(async (url) => {
      if (String(url).endsWith("/pulls/137")) {
        return jsonResponse({ state: "closed" });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    const cleanupPreview = vi.fn(async () => {
      throw new Error("worker delete failed");
    });
    const deleteNeonBranch = vi.fn(async () => {});

    await expect(
      cleanupStalePrPreviews(
        { github, cloudflare: {}, neon },
        { run, fetch, cleanupPreview, deleteNeonBranch, log: () => {} },
      ),
    ).rejects.toThrow("Cloudflare cleanup failed: worker delete failed");

    expect(deleteNeonBranch).toHaveBeenCalledWith("137", neon, expect.objectContaining({ fetch }));
  });

  it("does not clean previews when GitHub PR state cannot be classified", async () => {
    const run = vi.fn(async (_command, args) => {
      if (args.join(" ") === "exec wrangler hyperdrive list") {
        return { code: 0, stdout: hyperdriveList(["agent-paste-db-pr-137"]), stderr: "" };
      }
      if (args.join(" ") === "exec wrangler queues list") {
        return { code: 0, stdout: "", stderr: "" };
      }
      throw new Error(`Unexpected command ${args.join(" ")}`);
    });
    const fetch = vi.fn(async (url) => {
      if (String(url).endsWith("/pulls/137")) {
        return textResponse("server error", { status: 500 });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    const cleanupPreview = vi.fn(async () => {});
    const deleteNeonBranch = vi.fn(async () => {});

    await expect(
      cleanupStalePrPreviews(
        { github, cloudflare: {}, neon },
        { run, fetch, cleanupPreview, deleteNeonBranch, log: () => {} },
      ),
    ).resolves.toEqual({
      discovered: ["137"],
      stale: [],
      cleaned: [],
      dryRun: false,
    });

    expect(cleanupPreview).not.toHaveBeenCalled();
    expect(deleteNeonBranch).not.toHaveBeenCalled();
  });

  it("fails when GitHub context is missing", async () => {
    const run = vi.fn(async (_command, args) => {
      if (args.join(" ") === "exec wrangler hyperdrive list") {
        return { code: 0, stdout: hyperdriveList(["agent-paste-db-pr-137"]), stderr: "" };
      }
      if (args.join(" ") === "exec wrangler queues list") {
        return { code: 0, stdout: "", stderr: "" };
      }
      throw new Error(`Unexpected command ${args.join(" ")}`);
    });

    await expect(cleanupStalePrPreviews({ github: {}, cloudflare: {} }, { run, log: () => {} })).rejects.toThrow(
      "GITHUB_TOKEN",
    );
  });
});

describe("discoverPrPreviewNumbers", () => {
  it("discovers PR numbers from Hyperdrive, Queues, and Worker scripts", async () => {
    const run = vi.fn(async (_command, args) => {
      if (args.join(" ") === "exec wrangler hyperdrive list") {
        return { code: 0, stdout: hyperdriveList(["agent-paste-db-pr-137"]), stderr: "" };
      }
      if (args.join(" ") === "exec wrangler queues list") {
        return { code: 0, stdout: "bundle-generate-preview-pr-138", stderr: "" };
      }
      throw new Error(`Unexpected command ${args.join(" ")}`);
    });
    const fetch = vi.fn(async () =>
      jsonResponse({
        result: [{ id: "agent-paste-api-pr-139" }, { id: "agent-paste-content-preview" }],
      }),
    );

    await expect(discoverPrPreviewNumbers(cloudflare, { run, fetch })).resolves.toEqual(new Set(["137", "138", "139"]));
  });
});

describe("parseQueuePrPreviewNumbers", () => {
  it("extracts PR preview suffixes from queue list output", () => {
    expect(
      parseQueuePrPreviewNumbers(
        "byte-purge-preview-pr-137\nbundle-generate-dlq-preview-pr-138\nother-preview-pr-139\nnot-preview-pr-0",
      ),
    ).toEqual(new Set(["137", "138"]));
  });
});

describe("parseWorkerNames", () => {
  it("supports current and older Cloudflare response name fields", () => {
    expect(parseWorkerNames({ result: [{ id: "a" }, { script_name: "b" }, { name: "c" }, { id: "" }] })).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

function hyperdriveList(names) {
  return names.map((name, index) => `${String(index + 1).repeat(32)} ${name}`).join("\n");
}

function jsonResponse(payload, init = {}) {
  return textResponse(JSON.stringify(payload), init);
}

function textResponse(body, init = {}) {
  return new Response(body, { status: init.status ?? 200 });
}
