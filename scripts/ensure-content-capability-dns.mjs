#!/usr/bin/env node
// @ts-check

import { ensureContentCapabilityDns } from "./lib/content-capability-dns.mjs";

const result = await ensureContentCapabilityDns({
  apiToken: process.env.CLOUDFLARE_API_TOKEN ?? "",
  apiHost: process.env.CLOUDFLARE_API_HOST,
});

process.stdout.write(`Content capability wildcard DNS: ${result}.\n`);
