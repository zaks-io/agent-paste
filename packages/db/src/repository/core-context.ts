import { buildAgentView } from "../agent-view.js";
import { type UsagePolicyConfig, usagePolicyForWorkspace } from "../policy.js";
import { repositoryError } from "../repository-error.js";
import type { Artifact, RepositoryOptions, Revision, Workspace } from "../types.js";
import type { Entities, UnitOfWork } from "./ports.js";
import { toWebArtifactRow } from "./web-transforms.js";

export class RepositoryCoreContext {
  constructor(
    readonly uow: UnitOfWork,
    readonly options: RepositoryOptions,
  ) {}

  pepperForRecord(pepperKid: number): string | undefined {
    if (this.options.pepperRing) {
      return this.options.pepperRing.pepperForKid(pepperKid);
    }
    return pepperKid === 1 ? this.options.apiKeyPepper : undefined;
  }

  billingEnabled(): boolean {
    return this.options.billingEnabled ?? false;
  }

  usagePolicyFor(workspace: Pick<Workspace, "plan" | "claimed_at">): UsagePolicyConfig {
    return usagePolicyForWorkspace(workspace, this.billingEnabled());
  }

  async mustWorkspace(entities: Entities, id: string) {
    const workspace = await entities.workspaces.findById(id);
    if (!workspace) {
      repositoryError("workspace_not_found");
    }
    return workspace;
  }

  async mustApiKey(entities: Entities, id: string) {
    const apiKey = await entities.apiKeys.findById(id);
    if (!apiKey) {
      repositoryError("api_key_not_found");
    }
    return apiKey;
  }

  async mustMember(entities: Entities, id: string) {
    const member = await entities.members.findById(id);
    if (!member) {
      repositoryError("workspace_member_not_found");
    }
    return member;
  }

  async webArtifactDetailFromArtifact(entities: Entities, artifact: Artifact, workspaceId: string) {
    const revisionId = artifact.revision_id;
    let viewer: { iframe_src: string; render_mode: Revision["render_mode"] } | null = null;
    if (revisionId && artifact.status === "active") {
      const revision = await entities.revisions.findById(revisionId, workspaceId);
      if (revision && revision.status === "published") {
        const files = await entities.artifactFiles.listForArtifact(artifact.id, revisionId);
        const warnings = await entities.safetyWarnings.listForRevision(artifact.workspace_id, revisionId);
        const agentView = buildAgentView(
          artifact,
          revisionId,
          files,
          this.options.contentBaseUrl ?? "",
          revision,
          warnings,
        );
        viewer = {
          iframe_src: agentView.view_url,
          render_mode: revision.render_mode,
        };
      }
    }
    return {
      ...toWebArtifactRow(artifact),
      entrypoint: artifact.entrypoint,
      file_count: artifact.file_count,
      size_bytes: artifact.size_bytes,
      viewer,
    };
  }
}
