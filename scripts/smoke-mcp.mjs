#!/usr/bin/env node
import { runLocalMcpSmoke } from "./lib/smoke-mcp-local.mjs";
import {
  assert,
  assertMcpRejectsApiKey,
  assertMcpUnauthorizedChallenge,
  fetchMcpProtectedResource,
  MCP_TOOL_NAMES,
  mcpCallTool,
  mcpInitializeSession,
  mcpSmokeConfig,
  mcpToolsList,
  normalizeMcpSmokeTarget,
  waitForMcpHealth,
} from "./smoke-mcp-harness.mjs";

const target = normalizeMcpSmokeTarget(process.argv[2]);

if (target === "local") {
  await runLocalMcpSmoke();
} else {
  await runHostedMcpSmoke(target);
}

async function runHostedMcpSmoke(target) {
  const config = mcpSmokeConfig(target);
  await waitForMcpHealth(config.mcpBaseUrl);

  const metadata = await fetchMcpProtectedResource(config.mcpBaseUrl);
  assert(metadata.resource === config.resource, `resource indicator is ${config.resource}`);
  for (const scope of ["openid", "profile", "email", "offline_access"]) {
    assert(metadata.scopes_supported.includes(scope), `scopes_supported includes ${scope}`);
  }
  if (config.authorizationServers.length > 0) {
    for (const server of config.authorizationServers) {
      assert(metadata.authorization_servers.includes(server), `authorization_servers includes ${server}`);
    }
  }

  await assertMcpUnauthorizedChallenge(config.mcpBaseUrl, config.resource);
  await assertMcpRejectsApiKey(config.mcpBaseUrl);

  const accessToken = optionalEnv([
    "AGENT_PASTE_MCP_SMOKE_ACCESS_TOKEN",
    `AGENT_PASTE_${target.toUpperCase()}_MCP_SMOKE_ACCESS_TOKEN`,
  ]);
  if (!accessToken && target === "production") {
    throw new Error("Production MCP smoke requires a user OAuth access token.");
  }
  let authenticatedSummary = "Skipped authenticated MCP tool calls (no user OAuth token configured).";
  if (accessToken) {
    await mcpInitializeSession(config.mcpBaseUrl, accessToken);
    const tools = await mcpToolsList(config.mcpBaseUrl, accessToken);
    assert(tools.length === MCP_TOOL_NAMES.length, `tools/list returned ${MCP_TOOL_NAMES.length} tools`);
    for (const name of MCP_TOOL_NAMES) {
      assert(
        tools.some((tool) => tool.name === name),
        `tools/list includes ${name}`,
      );
    }
    const whoami = await mcpCallTool(config.mcpBaseUrl, accessToken, "whoami", {}, 3);
    assert(whoami.workspace?.id, "whoami returned workspace id");
    assert(whoami.workspace_member?.id, "whoami returned workspace member id");
    assert(Array.isArray(whoami.scopes), "whoami returned scopes");
    await mcpCallTool(config.mcpBaseUrl, accessToken, "list_artifacts", {}, 4);
    authenticatedSummary = `Authenticated checks passed (workspace ${whoami.workspace.id}).`;
  }

  process.stdout.write(`${config.label} MCP smoke passed.

MCP URL:     ${config.mcpBaseUrl}
Resource:    ${config.resource}
Audience:    ${config.audience}
Auth server: ${config.authorizationServers.join(", ") || "(not advertised)"}
${authenticatedSummary}
`);
}

function optionalEnv(names) {
  for (const name of names) {
    if (process.env[name]) {
      return process.env[name];
    }
  }
  return undefined;
}
