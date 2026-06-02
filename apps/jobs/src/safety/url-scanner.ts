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
    const submit = await fetchFn(`https://api.cloudflare.com/client/v4/accounts/${accountId}/urlscanner/v2/scan`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url }),
    });
    if (!submit.ok) {
      return "unknown";
    }
    const submitBody = (await submit.json()) as UrlScanSubmitResponse;
    const scanId = submitBody.result?.uuid;
    if (!scanId) {
      return "unknown";
    }
    for (let attempt = 0; attempt < SCAN_POLL_ATTEMPTS; attempt += 1) {
      if (attempt > 0) {
        await sleep(SCAN_POLL_DELAY_MS);
      }
      const resultResponse = await fetchFn(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/urlscanner/v2/result/${scanId}`,
        {
          headers: { Authorization: `Bearer ${apiToken}` },
        },
      );
      if (resultResponse.status === 404) {
        continue;
      }
      if (!resultResponse.ok) {
        return "unknown";
      }
      const body = (await resultResponse.json()) as UrlScanResultResponse;
      const status = body.result?.task?.status;
      if (status && status !== "Finished") {
        continue;
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
    return "unknown";
  } catch {
    return "unknown";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
