export type UrlScannerVerdict = "malicious" | "safe" | "unknown";

type UrlScanSubmitResponse = {
  success?: boolean;
  result?: { uuid?: string };
};

type UrlScanResultResponse = {
  success?: boolean;
  result?: {
    task?: { status?: string };
    verdicts?: { overall?: { malicious?: boolean } };
  };
};

const SCAN_POLL_ATTEMPTS = 4;
const SCAN_POLL_DELAY_MS = 2_500;

export async function scanPublishedUrlMalicious(input: {
  accountId?: string;
  apiToken?: string;
  url: string;
  fetchImpl?: typeof fetch;
}): Promise<UrlScannerVerdict> {
  const { accountId, apiToken, url } = input;
  if (!accountId || !apiToken) {
    return "unknown";
  }
  const fetchFn = input.fetchImpl ?? fetch;
  try {
    const scanId = await submitUrlScan({ accountId, apiToken, url, fetchFn });
    if (!scanId) {
      return "unknown";
    }
    return await pollUrlScanVerdict({ accountId, apiToken, scanId, fetchFn });
  } catch {
    return "unknown";
  }
}

async function submitUrlScan(input: {
  accountId: string;
  apiToken: string;
  url: string;
  fetchFn: typeof fetch;
}): Promise<string | null> {
  const submit = await input.fetchFn(
    `https://api.cloudflare.com/client/v4/accounts/${input.accountId}/urlscanner/v2/scan`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: input.url }),
    },
  );
  if (!submit.ok) {
    return null;
  }
  const submitBody = (await submit.json()) as UrlScanSubmitResponse;
  return submitBody.result?.uuid ?? null;
}

async function pollUrlScanVerdict(input: {
  accountId: string;
  apiToken: string;
  scanId: string;
  fetchFn: typeof fetch;
}): Promise<UrlScannerVerdict> {
  for (let attempt = 0; attempt < SCAN_POLL_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await sleep(SCAN_POLL_DELAY_MS);
    }
    const verdict = await readUrlScanAttempt(input);
    if (verdict !== "pending") {
      return verdict;
    }
  }
  return "unknown";
}

async function readUrlScanAttempt(input: {
  accountId: string;
  apiToken: string;
  scanId: string;
  fetchFn: typeof fetch;
}): Promise<UrlScannerVerdict | "pending"> {
  const resultResponse = await input.fetchFn(
    `https://api.cloudflare.com/client/v4/accounts/${input.accountId}/urlscanner/v2/result/${input.scanId}`,
    {
      headers: { Authorization: `Bearer ${input.apiToken}` },
    },
  );
  if (resultResponse.status === 404) {
    return "pending";
  }
  if (!resultResponse.ok) {
    return "unknown";
  }
  const body = (await resultResponse.json()) as UrlScanResultResponse;
  const status = body.result?.task?.status;
  if (status && status !== "Finished") {
    return "pending";
  }
  const malicious = body.result?.verdicts?.overall?.malicious;
  if (malicious === true) {
    return "malicious";
  }
  if (malicious === false) {
    return "safe";
  }
  return "unknown";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
