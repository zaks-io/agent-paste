// @ts-check
import assert from "node:assert/strict";
import { hostedTransferFetch } from "./lib/hosted-transfer-fetch.mjs";
import { hostedTransferEndpoints } from "./lib/transfer-endpoints.mjs";

const config = hostedTransferEndpoints(process.env);
const key = process.env.AGENT_PASTE_API_KEY;
assert(key?.startsWith("ap_pk_preview_"), "The hosted transfer child requires its provisioned preview key");
globalThis.fetch = hostedTransferFetch(config, key, { onEvent: (event) => process.send?.(event) });
