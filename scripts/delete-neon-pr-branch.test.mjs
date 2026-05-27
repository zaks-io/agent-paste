import { describe, expect, it, vi } from "vitest";
import { deleteNeonPrBranch, normalizePrNumber } from "./delete-neon-pr-branch.mjs";

const context = {
  apiHost: "https://console.neon.tech/api/v2",
  apiKey: "test-api-key",
  projectId: "test-project",
};

describe("deleteNeonPrBranch", () => {
  it("treats missing preview branches as already removed", async () => {
    const fetch = vi.fn(async () => jsonResponse({ branches: [{ id: "br-main", name: "main", default: true }] }));

    await expect(deleteNeonPrBranch("114", context, { fetch, log: () => {} })).resolves.toEqual({
      deleted: false,
      branchName: "preview/pr-114",
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url.toString()).toBe(
      "https://console.neon.tech/api/v2/projects/test-project/branches?search=preview%2Fpr-114&limit=10000",
    );
    expect(init).toEqual({
      headers: {
        Accept: "application/json",
        Authorization: "Bearer test-api-key",
      },
    });
  });

  it("deletes a matching preview branch by id", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          branches: [
            { id: "br-main", name: "main", default: true },
            { id: "br-preview-114", name: "preview/pr-114", default: false },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ branch: { id: "br-preview-114" } }));

    await expect(deleteNeonPrBranch(114, context, { fetch, log: () => {} })).resolves.toEqual({
      deleted: true,
      branchName: "preview/pr-114",
      branchId: "br-preview-114",
    });

    expect(fetch).toHaveBeenLastCalledWith(
      "https://console.neon.tech/api/v2/projects/test-project/branches/br-preview-114",
      {
        method: "DELETE",
        headers: {
          Accept: "application/json",
          Authorization: "Bearer test-api-key",
        },
      },
    );
  });

  it("keeps delete idempotent when Neon reports the branch absent during delete", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ branches: [{ id: "br-preview-114", name: "preview/pr-114" }] }))
      .mockResolvedValueOnce(textResponse("", { status: 404 }));

    await expect(deleteNeonPrBranch("114", context, { fetch, log: () => {} })).resolves.toEqual({
      deleted: true,
      branchName: "preview/pr-114",
      branchId: "br-preview-114",
    });
  });

  it("fails on Neon API errors", async () => {
    const fetch = vi.fn(async () => textResponse("unauthorized", { status: 401 }));

    await expect(deleteNeonPrBranch("114", context, { fetch, log: () => {} })).rejects.toThrow(
      "Neon branch list failed: 401 unauthorized",
    );
  });
});

describe("normalizePrNumber", () => {
  it("accepts positive integer PR numbers", () => {
    expect(normalizePrNumber(114)).toBe("114");
  });

  it("rejects invalid PR numbers", () => {
    expect(() => normalizePrNumber("0")).toThrow("positive integer");
    expect(() => normalizePrNumber("114abc")).toThrow("positive integer");
  });
});

function jsonResponse(payload, init = {}) {
  return textResponse(JSON.stringify(payload), init);
}

function textResponse(body, init = {}) {
  return new Response(body, { status: init.status ?? 200 });
}
