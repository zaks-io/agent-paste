import { describe, expect, it, vi } from "vitest";
import { scanPublishedUrlMalicious } from "./url-scanner.js";

describe("scanPublishedUrlMalicious", () => {
  it("returns unknown when credentials are missing", async () => {
    await expect(scanPublishedUrlMalicious({ url: "https://example.com" })).resolves.toBe("unknown");
  });

  it("returns unknown when submit or poll requests fail", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });

    await expect(
      scanPublishedUrlMalicious({
        accountId: "acct",
        apiToken: "token",
        url: "https://example.com",
        fetchImpl,
      }),
    ).resolves.toBe("unknown");
  });

  it("returns unknown when submit succeeds without a scan id", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, result: {} }),
    });
    await expect(
      scanPublishedUrlMalicious({
        accountId: "acct",
        apiToken: "token",
        url: "https://example.com",
        fetchImpl,
      }),
    ).resolves.toBe("unknown");
  });

  it("returns malicious when the URL Scanner verdict is malicious", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, result: { uuid: "scan-1" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: { task: { status: "Finished" }, verdicts: { overall: { malicious: true } } },
        }),
      });

    await expect(
      scanPublishedUrlMalicious({
        accountId: "acct",
        apiToken: "token",
        url: "https://example.com",
        fetchImpl,
      }),
    ).resolves.toBe("malicious");
  });

  it("polls until the scan finishes after an in-progress response", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, result: { uuid: "scan-1" } }),
      })
      .mockResolvedValueOnce({ ok: true, status: 404, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: { task: { status: "Finished" }, verdicts: { overall: { malicious: false } } },
        }),
      });

    await expect(
      scanPublishedUrlMalicious({
        accountId: "acct",
        apiToken: "token",
        url: "https://example.com",
        fetchImpl,
      }),
    ).resolves.toBe("safe");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("returns safe when the URL Scanner verdict is clean", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, result: { uuid: "scan-1" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: { task: { status: "Finished" }, verdicts: { overall: { malicious: false } } },
        }),
      });

    await expect(
      scanPublishedUrlMalicious({
        accountId: "acct",
        apiToken: "token",
        url: "https://example.com",
        fetchImpl,
      }),
    ).resolves.toBe("safe");
  });
});
