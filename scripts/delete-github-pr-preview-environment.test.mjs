import { describe, expect, it, vi } from "vitest";
import { deleteGithubPrPreviewEnvironment, normalizePrNumber } from "./delete-github-pr-preview-environment.mjs";

const context = {
  apiHost: "https://api.github.test",
  repository: "zaks-io/agent-paste",
  token: "test-token",
};

describe("deleteGithubPrPreviewEnvironment", () => {
  it("deletes the matching legacy PR preview environment", async () => {
    const fetch = vi.fn(async () => textResponse("", { status: 204 }));

    await expect(deleteGithubPrPreviewEnvironment("115", context, { fetch, log: () => {} })).resolves.toEqual({
      deleted: true,
      environmentName: "pr-preview-115",
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://api.github.test/repos/zaks-io/agent-paste/environments/pr-preview-115",
      {
        method: "DELETE",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer test-token",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
  });

  it("treats missing GitHub environments as already removed", async () => {
    const fetch = vi.fn(async () => textResponse("not found", { status: 404 }));

    await expect(deleteGithubPrPreviewEnvironment(115, context, { fetch, log: () => {} })).resolves.toEqual({
      deleted: false,
      environmentName: "pr-preview-115",
    });
  });

  it("fails with a permission hint when GitHub rejects the delete", async () => {
    const fetch = vi.fn(async () => textResponse("resource not accessible by integration", { status: 403 }));

    await expect(deleteGithubPrPreviewEnvironment("115", context, { fetch, log: () => {} })).rejects.toThrow(
      /Administration write permission/,
    );
  });

  it("rejects invalid inputs", async () => {
    await expect(deleteGithubPrPreviewEnvironment("0", context, { fetch: vi.fn() })).rejects.toThrow(
      "positive integer",
    );
    await expect(
      deleteGithubPrPreviewEnvironment("115", { ...context, repository: "agent-paste" }, { fetch: vi.fn() }),
    ).rejects.toThrow("owner/repo");
  });
});

describe("normalizePrNumber", () => {
  it("accepts positive integer PR numbers", () => {
    expect(normalizePrNumber(115)).toBe("115");
  });
});

function textResponse(body, init = {}) {
  const status = init.status ?? 200;
  return new Response(status === 204 || status === 304 ? null : body, { status });
}
