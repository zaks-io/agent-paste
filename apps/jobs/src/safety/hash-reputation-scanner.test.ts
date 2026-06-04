import { describe, expect, it, vi } from "vitest";
import {
  hashReputationWarnings,
  scanFileDigestMalicious,
  scanFilesHashReputation,
  sha256Hex,
} from "./hash-reputation-scanner.js";
import type { SafetyScannerFile } from "./scanner.js";

const encoder = new TextEncoder();

function file(path: string, content: string): SafetyScannerFile {
  return { path, contentType: "application/octet-stream", bytes: encoder.encode(content) };
}

function mbHit() {
  return { ok: true, json: async () => ({ query_status: "ok", data: [{ sha256_hash: "x" }] }) };
}
function mbMiss() {
  return { ok: true, json: async () => ({ query_status: "hash_not_found" }) };
}
function mbInconclusive() {
  return { ok: true, json: async () => ({ query_status: "http_post_expected" }) };
}

describe("sha256Hex", () => {
  it("hashes empty input to the known SHA-256 vector", async () => {
    await expect(sha256Hex(new Uint8Array())).resolves.toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("hashes 'abc' to the known SHA-256 vector", async () => {
    await expect(sha256Hex(encoder.encode("abc"))).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("scanFileDigestMalicious", () => {
  it("returns unknown and makes no request when no provider key is configured", async () => {
    const fetchImpl = vi.fn();
    await expect(scanFileDigestMalicious({ sha256: "deadbeef", fetchImpl })).resolves.toBe("unknown");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns malicious when MalwareBazaar has a record", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(mbHit());
    await expect(scanFileDigestMalicious({ sha256: "deadbeef", malwareBazaarApiKey: "k", fetchImpl })).resolves.toBe(
      "malicious",
    );
  });

  it("returns safe when MalwareBazaar reports hash_not_found", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(mbMiss());
    await expect(scanFileDigestMalicious({ sha256: "deadbeef", malwareBazaarApiKey: "k", fetchImpl })).resolves.toBe(
      "safe",
    );
  });

  it("returns unknown when MalwareBazaar responds non-ok", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) });
    await expect(scanFileDigestMalicious({ sha256: "deadbeef", malwareBazaarApiKey: "k", fetchImpl })).resolves.toBe(
      "unknown",
    );
  });

  it("returns unknown on an unrecognized MalwareBazaar query_status", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ query_status: "illegal_hash" }) });
    await expect(scanFileDigestMalicious({ sha256: "deadbeef", malwareBazaarApiKey: "k", fetchImpl })).resolves.toBe(
      "unknown",
    );
  });

  it("returns unknown when MalwareBazaar parsing throws", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => {
        throw new Error("bad json");
      },
    });
    await expect(scanFileDigestMalicious({ sha256: "deadbeef", malwareBazaarApiKey: "k", fetchImpl })).resolves.toBe(
      "unknown",
    );
  });

  it("returns unknown when the MalwareBazaar fetch rejects", async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error("network"));
    await expect(scanFileDigestMalicious({ sha256: "deadbeef", malwareBazaarApiKey: "k", fetchImpl })).resolves.toBe(
      "unknown",
    );
  });

  it("escalates to VirusTotal when MalwareBazaar is inconclusive and VT reports detections", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mbMiss())
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { attributes: { last_analysis_stats: { malicious: 3 } } } }),
      });
    await expect(
      scanFileDigestMalicious({ sha256: "deadbeef", malwareBazaarApiKey: "k", virusTotalApiKey: "vt", fetchImpl }),
    ).resolves.toBe("malicious");
  });

  it("returns safe when VirusTotal reports zero detections", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mbMiss())
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { attributes: { last_analysis_stats: { malicious: 0 } } } }),
      });
    await expect(
      scanFileDigestMalicious({ sha256: "deadbeef", malwareBazaarApiKey: "k", virusTotalApiKey: "vt", fetchImpl }),
    ).resolves.toBe("safe");
  });

  it("treats a VirusTotal 404 as safe (file unknown to the corpus)", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(mbMiss()).mockResolvedValueOnce({ status: 404, ok: false });
    await expect(
      scanFileDigestMalicious({ sha256: "deadbeef", malwareBazaarApiKey: "k", virusTotalApiKey: "vt", fetchImpl }),
    ).resolves.toBe("safe");
  });

  it("keeps a clean MalwareBazaar signal as safe even when VirusTotal is inconclusive", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(mbMiss()).mockResolvedValueOnce({ status: 429, ok: false });
    await expect(
      scanFileDigestMalicious({ sha256: "deadbeef", malwareBazaarApiKey: "k", virusTotalApiKey: "vt", fetchImpl }),
    ).resolves.toBe("safe");
  });

  it("returns unknown when VirusTotal rate-limits and MalwareBazaar was inconclusive", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ query_status: "http_post_expected" }) })
      .mockResolvedValueOnce({ status: 429, ok: false });
    await expect(
      scanFileDigestMalicious({ sha256: "deadbeef", malwareBazaarApiKey: "k", virusTotalApiKey: "vt", fetchImpl }),
    ).resolves.toBe("unknown");
  });

  it("returns unknown when the VirusTotal stats field is missing", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mbInconclusive())
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { attributes: {} } }) });
    await expect(
      scanFileDigestMalicious({ sha256: "deadbeef", malwareBazaarApiKey: "k", virusTotalApiKey: "vt", fetchImpl }),
    ).resolves.toBe("unknown");
  });

  it("returns unknown when both providers are inconclusive (MalwareBazaar unknown, VirusTotal throws)", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(mbInconclusive()).mockRejectedValueOnce(new Error("network"));
    await expect(
      scanFileDigestMalicious({ sha256: "deadbeef", malwareBazaarApiKey: "k", virusTotalApiKey: "vt", fetchImpl }),
    ).resolves.toBe("unknown");
  });

  it("short-circuits before VirusTotal when MalwareBazaar already says malicious", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(mbHit());
    await expect(
      scanFileDigestMalicious({ sha256: "deadbeef", malwareBazaarApiKey: "k", virusTotalApiKey: "vt", fetchImpl }),
    ).resolves.toBe("malicious");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("scanFilesHashReputation", () => {
  it("returns an empty result for no files", async () => {
    await expect(scanFilesHashReputation({ files: [] })).resolves.toEqual([]);
  });

  it("short-circuits without hashing when no provider key is configured", async () => {
    const fetchImpl = vi.fn();
    await expect(
      scanFilesHashReputation({ files: [file("a.bin", "x"), file("b.bin", "y")], fetchImpl }),
    ).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("hashes once per distinct digest and fans the verdict out to every matching file", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mbHit());
    const verdicts = await scanFilesHashReputation({
      files: [file("a.bin", "same"), file("b.bin", "same"), file("c.bin", "different")],
      malwareBazaarApiKey: "k",
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(verdicts.map((entry) => entry.verdict)).toEqual(["malicious", "malicious", "malicious"]);
    expect(verdicts[0]?.sha256).toBe(verdicts[1]?.sha256);
    expect(verdicts[0]?.sha256).not.toBe(verdicts[2]?.sha256);
  });
});

describe("hashReputationWarnings", () => {
  it("emits one warning per malicious file and nothing for safe or unknown", async () => {
    const target = file("evil.bin", "x");
    const warnings = hashReputationWarnings([
      { file: target, sha256: "a", verdict: "malicious" },
      { file: file("ok.bin", "y"), sha256: "b", verdict: "safe" },
      { file: file("maybe.bin", "z"), sha256: "c", verdict: "unknown" },
    ]);
    expect(warnings).toEqual([
      {
        code: "known_malware_signature",
        severity: "warning",
        scope: "file",
        file_path: "evil.bin",
        message: "This revision contains a file matching a known malware signature.",
      },
    ]);
  });
});
