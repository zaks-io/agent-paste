import { describe, expect, it } from "vitest";
import { accountlessProvisionProbeCommand, networkProbeCommand, resolveNetworkAllowList } from "./network";

describe("network allowlist", () => {
  it("resolves configured domains into Daytona CIDR allowlist entries", async () => {
    const allowList = await resolveNetworkAllowList(
      {
        allow_cidrs: ["203.0.113.10/32"],
        allow_domains: ["agent-paste.sh", "api.preview.agent-paste.sh"],
        block_all: false,
        probe_urls: [],
      },
      async (domain) => (domain === "agent-paste.sh" ? ["192.0.2.1", "192.0.2.2"] : ["192.0.2.1"]),
    );

    expect(allowList).toBe("203.0.113.10/32,192.0.2.1/32,192.0.2.2/32");
  });

  it("rejects allowlists that exceed Daytona's ten-entry limit", async () => {
    await expect(
      resolveNetworkAllowList(
        {
          allow_cidrs: Array.from({ length: 11 }, (_, index) => `192.0.2.${index}/32`),
          allow_domains: [],
          block_all: false,
          probe_urls: [],
        },
        async () => [],
      ),
    ).rejects.toThrow("daytona_network_allowlist_too_large");
  });

  it("rejects invalid CIDR octets", async () => {
    await expect(
      resolveNetworkAllowList(
        {
          allow_cidrs: ["999.0.0.1/32"],
          allow_domains: [],
          block_all: false,
          probe_urls: [],
        },
        async () => [],
      ),
    ).rejects.toThrow("invalid_daytona_network_cidr:999.0.0.1/32");
  });

  it("builds a curl preflight for configured probe urls", () => {
    const command = networkProbeCommand(["https://preview.agent-paste.sh/agents.md"]);

    expect(command).toContain("curl -fsSL --max-time 20 -o /dev/null");
    expect(command).toContain("'https://preview.agent-paste.sh/agents.md'");
  });

  it("builds an accountless provision preflight that avoids printing success secrets", () => {
    const command = accountlessProvisionProbeCommand();
    expect(command).toContain("/v1/ephemeral/provision");
    expect(command).toContain("AGENT_PASTE_EVAL_CLAIM_CODE");
    expect(command).toContain("AGENT_PASTE_EVAL_TARGET");
    expect(command).toContain("payload.api_key_secret");
    expect(command).toContain("ap_pk_preview_");
    expect(command).toContain("ap_ct_preview_");
    expect(command).not.toContain("payload.api_key ");
    expect(command).not.toContain("console.log");
  });
});
