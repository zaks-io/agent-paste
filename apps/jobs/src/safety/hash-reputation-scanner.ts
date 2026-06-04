import type { SafetyScannerFile, SafetyScannerWarning } from "./scanner.js";

export type HashReputationVerdict = "malicious" | "safe" | "unknown";

export type HashFileVerdict = {
  file: SafetyScannerFile;
  sha256: string;
  verdict: HashReputationVerdict;
};

const MALWARE_BAZAAR_ENDPOINT = "https://mb-api.abuse.ch/api/v1/";
const VIRUSTOTAL_FILE_ENDPOINT = "https://www.virustotal.com/api/v3/files";
const PROVIDER_TIMEOUT_MS = 8_000;

type MalwareBazaarResponse = {
  query_status?: string;
  data?: unknown[];
};

type VirusTotalResponse = {
  data?: { attributes?: { last_analysis_stats?: { malicious?: number } } };
};

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function scanFileDigestMalicious(input: {
  sha256: string;
  malwareBazaarApiKey?: string;
  virusTotalApiKey?: string;
  fetchImpl?: typeof fetch;
}): Promise<HashReputationVerdict> {
  const fetchFn = input.fetchImpl ?? fetch;
  const bazaar = await queryMalwareBazaar(input.sha256, input.malwareBazaarApiKey, fetchFn);
  if (bazaar === "malicious") {
    return "malicious";
  }
  let total: HashReputationVerdict = "unknown";
  if (input.virusTotalApiKey) {
    total = await queryVirusTotal(input.sha256, input.virusTotalApiKey, fetchFn);
    if (total === "malicious") {
      return "malicious";
    }
  }
  if (bazaar === "safe" || total === "safe") {
    return "safe";
  }
  return "unknown";
}

export async function scanFilesHashReputation(input: {
  files: readonly SafetyScannerFile[];
  malwareBazaarApiKey?: string;
  virusTotalApiKey?: string;
  fetchImpl?: typeof fetch;
}): Promise<HashFileVerdict[]> {
  if (!input.malwareBazaarApiKey && !input.virusTotalApiKey) {
    return [];
  }

  const digests = new Set<string>();
  const fileDigests: Array<{ file: SafetyScannerFile; sha256: string | null }> = [];
  for (const file of input.files) {
    const sha256 = await safeSha256Hex(file.bytes);
    fileDigests.push({ file, sha256 });
    if (sha256) {
      digests.add(sha256);
    }
  }

  const verdictByDigest = new Map<string, HashReputationVerdict>();
  for (const sha256 of digests) {
    verdictByDigest.set(
      sha256,
      await scanFileDigestMalicious({
        sha256,
        ...(input.malwareBazaarApiKey ? { malwareBazaarApiKey: input.malwareBazaarApiKey } : {}),
        ...(input.virusTotalApiKey ? { virusTotalApiKey: input.virusTotalApiKey } : {}),
        ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
      }),
    );
  }

  return fileDigests.map(({ file, sha256 }) => ({
    file,
    sha256: sha256 ?? "",
    verdict: sha256 ? (verdictByDigest.get(sha256) ?? "unknown") : "unknown",
  }));
}

async function safeSha256Hex(bytes: Uint8Array): Promise<string | null> {
  try {
    return await sha256Hex(bytes);
  } catch {
    return null;
  }
}

export function hashReputationWarnings(verdicts: readonly HashFileVerdict[]): SafetyScannerWarning[] {
  return verdicts
    .filter((entry) => entry.verdict === "malicious")
    .map((entry) => ({
      code: "known_malware_signature",
      severity: "warning",
      scope: "file",
      file_path: entry.file.path,
      message: "This revision contains a file matching a known malware signature.",
    }));
}

async function queryMalwareBazaar(
  sha256: string,
  apiKey: string | undefined,
  fetchFn: typeof fetch,
): Promise<HashReputationVerdict> {
  if (!apiKey) {
    return "unknown";
  }
  try {
    const response = await fetchWithTimeout(fetchFn, MALWARE_BAZAAR_ENDPOINT, {
      method: "POST",
      headers: {
        "Auth-Key": apiKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ query: "get_info", hash: sha256 }).toString(),
    });
    if (!response.ok) {
      return "unknown";
    }
    const body = (await response.json()) as MalwareBazaarResponse;
    if (body.query_status === "ok" && Array.isArray(body.data) && body.data.length > 0) {
      return "malicious";
    }
    if (body.query_status === "hash_not_found" || body.query_status === "no_results") {
      return "safe";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

async function queryVirusTotal(sha256: string, apiKey: string, fetchFn: typeof fetch): Promise<HashReputationVerdict> {
  try {
    const response = await fetchWithTimeout(fetchFn, `${VIRUSTOTAL_FILE_ENDPOINT}/${sha256}`, {
      headers: { "x-apikey": apiKey },
    });
    if (response.status === 404) {
      return "safe";
    }
    if (!response.ok) {
      return "unknown";
    }
    const body = (await response.json()) as VirusTotalResponse;
    const malicious = body.data?.attributes?.last_analysis_stats?.malicious;
    if (typeof malicious !== "number") {
      return "unknown";
    }
    return malicious > 0 ? "malicious" : "safe";
  } catch {
    return "unknown";
  }
}

async function fetchWithTimeout(fetchFn: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, PROVIDER_TIMEOUT_MS);
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
