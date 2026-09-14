import type { LoginConfig } from "./config.js";

const DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";
const DEFAULT_POLL_INTERVAL_SECONDS = 5;
const SLOW_DOWN_SECONDS = 5;
const MAX_OAUTH_RESPONSE_BYTES = 64 * 1024;
const MAX_REQUEST_MILLISECONDS = 30_000;
const MAX_TIMER_MILLISECONDS = 2_147_483_647;

export type DeviceLoginToken = {
  access_token: string;
  id_token?: string;
};

export type DeviceLoginDeps = {
  config: LoginConfig;
  fetch: typeof fetch;
  log: (message: string) => void;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
};

type DeviceAuthorization = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresInSeconds: number;
  intervalSeconds: number;
};

export async function loginWithDeviceCode(deps: DeviceLoginDeps): Promise<DeviceLoginToken> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? wait;
  const authorization = await authorizeDevice(deps.fetch, deps.config);
  deps.log(
    `Open this URL in a browser:\n${authorization.verificationUriComplete}\n\nOr visit ${authorization.verificationUri} and enter code ${authorization.userCode}.`,
  );

  const expiresAt = now() + authorization.expiresInSeconds * 1_000;
  let intervalMilliseconds = authorization.intervalSeconds * 1_000;

  while (true) {
    await sleepUntilNextPoll(sleep, now, expiresAt, intervalMilliseconds);
    const result = await pollForToken(deps.fetch, deps.config, authorization.deviceCode, now, expiresAt);
    if (result === "slow_down") {
      intervalMilliseconds += SLOW_DOWN_SECONDS * 1_000;
      continue;
    }
    if (result === "pending") continue;
    return result;
  }
}

async function sleepUntilNextPoll(
  sleep: (milliseconds: number) => Promise<void>,
  now: () => number,
  expiresAt: number,
  intervalMilliseconds: number,
): Promise<void> {
  const remaining = expiresAt - now();
  if (remaining <= 0) throw expiredError();
  if (intervalMilliseconds > MAX_TIMER_MILLISECONDS) {
    throw new Error("Device authorization polling interval exceeds the supported timer limit.");
  }
  await sleep(Math.min(intervalMilliseconds, remaining));
  if (now() >= expiresAt) throw expiredError();
}

async function pollForToken(
  fetchImpl: typeof fetch,
  config: LoginConfig,
  deviceCode: string,
  now: () => number,
  expiresAt: number,
): Promise<DeviceLoginToken | "pending" | "slow_down"> {
  let result: OAuthResponse;
  try {
    result = await postForm(
      fetchImpl,
      config.tokenUrl,
      new URLSearchParams({
        grant_type: DEVICE_GRANT_TYPE,
        device_code: deviceCode,
        client_id: config.clientId,
      }),
      "Device token request",
      MAX_REQUEST_MILLISECONDS,
    );
  } catch (error) {
    if (now() >= expiresAt) throw expiredError();
    throw error;
  }
  const token = parseTokenPoll(result);
  // Tokens issued by the server remain valid if the device code expires in transit.
  if (typeof token === "string" && now() >= expiresAt) throw expiredError();
  return token;
}

function parseTokenPoll({ body, response }: OAuthResponse): DeviceLoginToken | "pending" | "slow_down" {
  const error = typeof body.error === "string" ? body.error : null;
  if (error === "authorization_pending") return "pending";
  if (error === "slow_down") return "slow_down";
  if (error === "access_denied") throw new Error("Device authorization was denied.");
  if (error === "expired_token") throw expiredError();
  if (error !== null) throw new Error(`Device token request failed with status ${response.status}.`);
  if (Object.hasOwn(body, "error")) throw new Error("Device token request returned an invalid response.");
  if (!response.ok) throw new Error(`Device token request failed with status ${response.status}.`);

  const accessToken = requiredString(body.access_token);
  const idToken = body.id_token === undefined ? undefined : requiredString(body.id_token);
  if (!accessToken || (body.id_token !== undefined && !idToken)) {
    throw new Error("Device token request returned an invalid response.");
  }
  return idToken ? { access_token: accessToken, id_token: idToken } : { access_token: accessToken };
}

async function authorizeDevice(fetchImpl: typeof fetch, config: LoginConfig): Promise<DeviceAuthorization> {
  const { body, response } = await postForm(
    fetchImpl,
    config.deviceAuthorizationUrl,
    new URLSearchParams({ client_id: config.clientId, scope: "openid profile email" }),
    "Device authorization request",
    MAX_REQUEST_MILLISECONDS,
  );
  if (!response.ok) {
    throw new Error(`Device authorization request failed with status ${response.status}.`);
  }

  const deviceCode = requiredString(body.device_code);
  const userCode = requiredString(body.user_code);
  const verificationUri = validWebUrl(body.verification_uri);
  const verificationUriComplete = validWebUrl(body.verification_uri_complete);
  const expiresInSeconds = positiveInteger(body.expires_in);
  const intervalSeconds = body.interval === undefined ? DEFAULT_POLL_INTERVAL_SECONDS : positiveInteger(body.interval);
  if (
    !deviceCode ||
    !userCode ||
    !verificationUri ||
    !verificationUriComplete ||
    !expiresInSeconds ||
    !intervalSeconds
  ) {
    throw new Error("Device authorization request returned an invalid response.");
  }
  return { deviceCode, userCode, verificationUri, verificationUriComplete, expiresInSeconds, intervalSeconds };
}

async function postForm(
  fetchImpl: typeof fetch,
  url: string,
  body: URLSearchParams,
  operation: string,
  timeoutMilliseconds: number,
): Promise<OAuthResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, timeoutMilliseconds));
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: body.toString(),
      signal: controller.signal,
    });
    return { response, body: await readJsonObject(response, operation) };
  } catch (error) {
    if (error instanceof OAuthResponseError) throw error;
    throw new Error(`${operation} failed.`);
  } finally {
    clearTimeout(timeout);
  }
}

type OAuthResponse = {
  response: Response;
  body: Record<string, unknown>;
};

class OAuthResponseError extends Error {}

async function readJsonObject(response: Response, operation: string): Promise<Record<string, unknown>> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > MAX_OAUTH_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new OAuthResponseError(`${operation} returned an oversized response.`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new OAuthResponseError(`${operation} returned an invalid response.`);
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_OAUTH_RESPONSE_BYTES) {
      await reader.cancel();
      throw new OAuthResponseError(`${operation} returned an oversized response.`);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error();
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new OAuthResponseError(`${operation} returned an invalid response.`);
  }
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function validWebUrl(value: unknown): string | null {
  const candidate = requiredString(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? candidate : null;
  } catch {
    return null;
  }
}

function expiredError(): Error {
  return new Error("Device authorization expired. Run agent-paste login --device-code again.");
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
