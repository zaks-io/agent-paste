import { describe, expect, it, vi } from "vitest";
import type { Entities } from "../repository/ports.js";
import { resolveLockdownAuditWorkspaceId } from "./lockdown-audit.js";

function entitiesStub(input: {
  workspace?: { id: string } | null;
  artifact?: { workspace_id: string } | null;
}): Entities {
  return {
    workspaces: {
      findById: vi.fn(async () => input.workspace ?? null),
    },
    artifacts: {
      findById: vi.fn(async () =>
        input.artifact
          ? ({
              id: "art_1",
              workspace_id: input.artifact.workspace_id,
            } as Awaited<ReturnType<Entities["artifacts"]["findById"]>>)
          : null,
      ),
    },
  } as unknown as Entities;
}

describe("resolveLockdownAuditWorkspaceId", () => {
  it("returns the workspace id for workspace-scoped lockdowns when the row exists", async () => {
    const entities = entitiesStub({ workspace: { id: "ws_abc" } });
    await expect(resolveLockdownAuditWorkspaceId(entities, "workspace", "ws_abc")).resolves.toBe("ws_abc");
  });

  it("returns null for workspace-scoped lockdowns when the workspace is unknown", async () => {
    const entities = entitiesStub({ workspace: null });
    await expect(resolveLockdownAuditWorkspaceId(entities, "workspace", "ws_missing")).resolves.toBeNull();
  });

  it("returns the artifact workspace for artifact-scoped lockdowns", async () => {
    const entities = entitiesStub({ artifact: { workspace_id: "ws_from_art" } });
    await expect(resolveLockdownAuditWorkspaceId(entities, "artifact", "art_1")).resolves.toBe("ws_from_art");
  });

  it("returns null when the artifact cannot be resolved", async () => {
    const entities = entitiesStub({ artifact: null });
    await expect(resolveLockdownAuditWorkspaceId(entities, "artifact", "art_missing")).resolves.toBeNull();
  });
});
