// @ts-check

const ZONE_NAME = "agent-paste.link";
const WILDCARD_NAME = `*.${ZONE_NAME}`;
const WILDCARD_CONTENT = "100::";

/**
 * @typedef {{ id: string, name: string, status?: string }} CloudflareZone
 * @typedef {{ id: string, name: string, type: string, content: string, proxied: boolean }} CloudflareDnsRecord
 * @typedef {{ success: boolean, result?: unknown, errors?: Array<{ code?: number, message?: string }> }} CloudflareResponse
 */

/**
 * Ensure the wildcard DNS record required by capability-scoped content hosts.
 * Existing records are never overwritten because a conflicting wildcard could
 * route unrelated traffic and must be resolved deliberately.
 *
 * @param {{ apiToken: string, apiHost?: string }} input
 * @param {{ fetchImpl?: typeof fetch }} [dependencies]
 * @returns {Promise<"created" | "unchanged">}
 */
export async function ensureContentCapabilityDns(input, dependencies = {}) {
  if (!input.apiToken) {
    throw new Error("CLOUDFLARE_API_TOKEN is required to provision content capability DNS.");
  }
  const apiHost = (input.apiHost ?? "https://api.cloudflare.com/client/v4").replace(/\/$/, "");
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const headers = {
    authorization: `Bearer ${input.apiToken}`,
    "content-type": "application/json",
  };

  const zonePayload = await cloudflareRequest(
    fetchImpl,
    `${apiHost}/zones?name=${encodeURIComponent(ZONE_NAME)}&status=active&match=all`,
    { headers },
  );
  const zones = /** @type {CloudflareZone[]} */ (zonePayload.result);
  if (zones.length !== 1 || zones[0]?.name !== ZONE_NAME) {
    throw new Error(`Expected exactly one active Cloudflare zone named ${ZONE_NAME}; received ${zones.length}.`);
  }
  const zoneId = zones[0].id;

  const recordPayload = await cloudflareRequest(
    fetchImpl,
    `${apiHost}/zones/${encodeURIComponent(zoneId)}/dns_records?name=${encodeURIComponent(WILDCARD_NAME)}&match=all`,
    { headers },
  );
  const records = /** @type {CloudflareDnsRecord[]} */ (recordPayload.result);
  if (records.length > 0) {
    if (records.length === 1 && isExpectedRecord(records[0])) {
      return "unchanged";
    }
    throw new Error(
      `Refusing to overwrite existing DNS records for ${WILDCARD_NAME}; expected one proxied AAAA record targeting ${WILDCARD_CONTENT}.`,
    );
  }

  await cloudflareRequest(fetchImpl, `${apiHost}/zones/${encodeURIComponent(zoneId)}/dns_records`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      type: "AAAA",
      name: WILDCARD_NAME,
      content: WILDCARD_CONTENT,
      proxied: true,
      ttl: 1,
      comment: "Capability-scoped content Worker route",
    }),
  });
  return "created";
}

/** @param {CloudflareDnsRecord} record */
function isExpectedRecord(record) {
  return (
    record.name === WILDCARD_NAME &&
    record.type === "AAAA" &&
    record.content === WILDCARD_CONTENT &&
    record.proxied === true
  );
}

/**
 * @param {typeof fetch} fetchImpl
 * @param {string} url
 * @param {RequestInit} init
 * @returns {Promise<CloudflareResponse & { result: unknown }>}
 */
async function cloudflareRequest(fetchImpl, url, init) {
  const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(15_000) });
  const payload = /** @type {CloudflareResponse} */ (await response.json());
  if (!response.ok || payload.success !== true || payload.result === undefined) {
    const errors = payload.errors?.map((error) => `${error.code ?? "unknown"}: ${error.message ?? "unknown"}`);
    throw new Error(`Cloudflare API request failed (${response.status}): ${errors?.join("; ") || "unknown error"}`);
  }
  return /** @type {CloudflareResponse & { result: unknown }} */ (payload);
}
