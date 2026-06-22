import { resolve4 } from "node:dns/promises";
import type { SandboxNetworkConfig } from "./types";

const MAX_DAYTONA_ALLOWLIST_ENTRIES = 10;

export async function resolveNetworkAllowList(
  config: SandboxNetworkConfig,
  resolver: (domain: string) => Promise<string[]> = resolve4,
): Promise<string | undefined> {
  const cidrs = new Set(config.allow_cidrs.map(normalizeCidr));
  for (const domain of config.allow_domains) {
    const addresses = await resolver(domain);
    for (const address of addresses) {
      cidrs.add(`${address}/32`);
    }
  }
  if (cidrs.size === 0) {
    return undefined;
  }
  if (cidrs.size > MAX_DAYTONA_ALLOWLIST_ENTRIES) {
    throw new Error(`daytona_network_allowlist_too_large:${cidrs.size}>${MAX_DAYTONA_ALLOWLIST_ENTRIES}`);
  }
  return Array.from(cidrs).join(",");
}

export function networkProbeCommand(urls: string[]): string | undefined {
  if (urls.length === 0) {
    return undefined;
  }
  return [
    "set -eu",
    ...urls.map(
      (url) =>
        `echo ${shellQuote(`network preflight ${url}`)}\ncurl -fsSL --max-time 20 -o /dev/null ${shellQuote(url)}`,
    ),
  ].join("\n");
}

export function accountlessProvisionProbeCommand(): string {
  return [
    "set -eu",
    "node --input-type=module - <<'NODE'",
    "const apiUrl = process.env.AGENT_PASTE_API_URL;",
    "if (!apiUrl) {",
    '  console.error(JSON.stringify({ code: "missing_agent_paste_api_url" }));',
    "  process.exit(1);",
    "}",
    "const claimCode = process.env.AGENT_PASTE_EVAL_CLAIM_CODE;",
    "const target = process.env.AGENT_PASTE_EVAL_TARGET;",
    'const url = apiUrl.replace(/\\/+$/, "") + "/v1/ephemeral/provision";',
    "const response = await fetch(url, {",
    '  method: "POST",',
    '  headers: { "content-type": "application/json", accept: "application/json" },',
    "  body: JSON.stringify(claimCode ? { claim_code: claimCode } : {}),",
    "});",
    "const text = await response.text();",
    "let payload;",
    "try {",
    "  payload = JSON.parse(text);",
    "} catch {",
    "  payload = undefined;",
    "}",
    "if (",
    "  !response.ok ||",
    "  !payload ||",
    '  typeof payload.api_key_secret !== "string" ||',
    '  typeof payload.workspace_id !== "string"',
    ") {",
    "  const error = payload?.error;",
    "  console.error(",
    "    JSON.stringify({",
    "      status: response.status,",
    '      code: error?.code ?? "invalid_accountless_provision_response",',
    "      message: error?.message,",
    "      request_id: error?.request_id,",
    "    }),",
    "  );",
    "  process.exit(1);",
    "}",
    'if (target === "preview") {',
    "  const hostname = new URL(apiUrl).hostname;",
    '  if (hostname !== "api.preview.agent-paste.sh") {',
    '    console.error(JSON.stringify({ code: "wrong_api_environment", hostname, target }));',
    "    process.exit(1);",
    "  }",
    '  if (!payload.api_key_secret.startsWith("ap_pk_preview_") || !payload.claim_token?.startsWith("ap_ct_preview_")) {',
    '    console.error(JSON.stringify({ code: "wrong_credential_environment", target }));',
    "    process.exit(1);",
    "  }",
    "}",
    "NODE",
  ].join("\n");
}

function normalizeCidr(value: string): string {
  const match = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(?:[0-9]|[1-2][0-9]|3[0-2])$/);
  if (!match) {
    throw new Error(`invalid_daytona_network_cidr:${value}`);
  }
  const octets = match.slice(1, 5).map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) {
    throw new Error(`invalid_daytona_network_cidr:${value}`);
  }
  return value;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
