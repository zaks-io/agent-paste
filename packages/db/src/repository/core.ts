import {
  peekArtifactDenylistRetention as peekArtifactDenylistRetentionCore,
  peekArtifactPlatformLockdownRetention as peekArtifactPlatformLockdownRetentionCore,
} from "../access-link-invalidation.js";
import type { UsagePolicyConfig } from "../policy.js";
import type { AdminActor, ApiActor, ApiKeyActor, PlatformActor, RepositoryOptions, Workspace } from "../types.js";
import { RepositoryCoreContext } from "./core-context.js";
import type { Repository } from "./interface.js";
import type { OperatorEventFilters } from "./operator-event-filters.js";
import type { UnitOfWork } from "./ports.js";
import type { CreateUploadSessionRequest } from "./upload-session-lifecycle.js";
import * as accessLinksWorkflow from "./workflows/access-links-workflow.js";
import * as cleanupWorkflow from "./workflows/cleanup-workflow.js";
import * as ephemeralWorkflow from "./workflows/ephemeral-workflow.js";
import * as lockdownWorkflow from "./workflows/lockdown-workflow.js";
import * as memberArtifactsWorkflow from "./workflows/member-artifacts-workflow.js";
import * as uploadPublishWorkflow from "./workflows/upload-publish-workflow.js";
import * as webDashboardWorkflow from "./workflows/web-dashboard-workflow.js";
import * as webMemberWorkflow from "./workflows/web-member-workflow.js";
import * as workspaceAdminWorkflow from "./workflows/workspace-admin-workflow.js";

// Backend-agnostic domain orchestration. Every method delegates storage to the
// scope-bound Entities accessor and durability to the UnitOfWork. The Postgres and
// local adapters supply those ports; this class holds the one copy of the logic.
export class RepositoryCore implements Repository {
  private readonly ctx: RepositoryCoreContext;

  constructor(uow: UnitOfWork, options: RepositoryOptions) {
    this.ctx = new RepositoryCoreContext(uow, options);
  }

  async createWorkspace(input: {
    actor: AdminActor;
    idempotencyKey: string;
    email: string;
    name?: string;
    now?: Date;
  }): Promise<Workspace> {
    return workspaceAdminWorkflow.createWorkspace(this.ctx, input);
  }

  async createEphemeralWorkspace(input: { idempotencyKey: string; now?: Date; claimTokenExpiresInSeconds?: number }) {
    return ephemeralWorkflow.createEphemeralWorkspace(this.ctx, input);
  }

  async claimEphemeralWorkspace(input: {
    actor: ApiActor;
    claimTokenSecret: string;
    idempotencyKey: string;
    now?: Date;
  }) {
    return ephemeralWorkflow.claimEphemeralWorkspace(this.ctx, input);
  }

  async peekEphemeralClaimReplay(input: { actor: ApiActor; idempotencyKey: string }) {
    return ephemeralWorkflow.peekEphemeralClaimReplay(this.ctx, input);
  }

  async listWorkspaces() {
    return workspaceAdminWorkflow.listWorkspaces(this.ctx);
  }

  async createApiKey(input: {
    actor: AdminActor;
    idempotencyKey: string;
    workspaceId: string;
    name: string;
    now?: Date;
  }) {
    return workspaceAdminWorkflow.createApiKey(this.ctx, input);
  }

  async revokeApiKey(input: { actor: AdminActor; idempotencyKey: string; apiKeyId: string; now?: Date }) {
    return workspaceAdminWorkflow.revokeApiKey(this.ctx, input);
  }

  async verifyApiKey(apiKeySecret: string): Promise<ApiKeyActor | null> {
    return workspaceAdminWorkflow.verifyApiKey(this.ctx, apiKeySecret);
  }

  async getWhoami(actor: ApiKeyActor) {
    return workspaceAdminWorkflow.getWhoami(this.ctx, actor);
  }

  async getUsagePolicy(actor: ApiKeyActor): Promise<UsagePolicyConfig> {
    return workspaceAdminWorkflow.getUsagePolicy(this.ctx, actor);
  }

  async resolveWebMember(input: { workosUserId: string; email: string; idempotencyKey: string; now?: string }) {
    return webMemberWorkflow.resolveWebMember(this.ctx, input);
  }

  async getWebMemberByWorkOsUserId(input: { workosUserId: string }) {
    return webMemberWorkflow.getWebMemberByWorkOsUserId(this.ctx, input);
  }

  async ensureWebMember(input: { workosUserId: string; email: string; now?: string }) {
    return webMemberWorkflow.ensureWebMember(this.ctx, input);
  }

  async getWebWorkspace(actor: ApiActor) {
    return webDashboardWorkflow.getWebWorkspace(this.ctx, actor);
  }

  async listWebArtifacts(actor: ApiActor, pagination: { cursor?: string; limit?: number } = {}) {
    return webDashboardWorkflow.listWebArtifacts(this.ctx, actor, pagination);
  }

  async getWebArtifact(actor: ApiActor, artifactId: string) {
    return webDashboardWorkflow.getWebArtifact(this.ctx, actor, artifactId);
  }

  async pinWebArtifact(input: { actor: ApiActor; idempotencyKey: string; artifactId: string; now?: Date }) {
    return webDashboardWorkflow.pinWebArtifact(this.ctx, input);
  }

  async unpinWebArtifact(input: { actor: ApiActor; idempotencyKey: string; artifactId: string; now?: Date }) {
    return webDashboardWorkflow.unpinWebArtifact(this.ctx, input);
  }

  async listWebApiKeys(actor: ApiActor) {
    return webDashboardWorkflow.listWebApiKeys(this.ctx, actor);
  }

  async createWebApiKey(input: {
    actor: ApiActor;
    idempotencyKey: string;
    name: string;
    expiresInSeconds?: number;
    now?: Date;
  }) {
    return webDashboardWorkflow.createWebApiKey(this.ctx, input);
  }

  async revokeCurrentApiKey(input: { actor: ApiKeyActor; now?: Date }) {
    return webDashboardWorkflow.revokeCurrentApiKey(this.ctx, input);
  }

  async revokeWebApiKey(input: { actor: ApiActor; idempotencyKey: string; apiKeyId: string; now?: Date }) {
    return webDashboardWorkflow.revokeWebApiKey(this.ctx, input);
  }

  async listWebAuditEvents(actor: ApiActor, pagination: { cursor?: string; limit?: number } = {}) {
    return webDashboardWorkflow.listWebAuditEvents(this.ctx, actor, pagination);
  }

  async getWebSettings(actor: ApiActor) {
    return webDashboardWorkflow.getWebSettings(this.ctx, actor);
  }

  async updateWebSettings(input: {
    actor: ApiActor;
    idempotencyKey: string;
    workspaceName: string;
    autoDeletionDays: number;
    now?: Date;
  }) {
    return webDashboardWorkflow.updateWebSettings(this.ctx, input);
  }

  async listLockdowns(_actor: PlatformActor, pagination: { cursor?: string; limit?: number } = {}) {
    return lockdownWorkflow.listLockdowns(this.ctx, _actor, pagination);
  }

  async listOperatorEvents(
    _actor: PlatformActor,
    filters: OperatorEventFilters & { cursor?: string; limit?: number } = {},
  ) {
    return lockdownWorkflow.listOperatorEvents(this.ctx, _actor, filters);
  }

  async setLockdown(input: {
    actor: PlatformActor;
    idempotencyKey: string;
    scope: "workspace" | "artifact";
    targetId: string;
    reasonCode: string;
    requestId?: string;
    now?: Date;
  }) {
    return lockdownWorkflow.setLockdown(this.ctx, input);
  }

  async liftLockdown(input: {
    actor: PlatformActor;
    idempotencyKey: string;
    scope: "workspace" | "artifact";
    targetId: string;
    requestId?: string;
    now?: Date;
  }) {
    return lockdownWorkflow.liftLockdown(this.ctx, input);
  }

  async createUploadSession(input: {
    actor: ApiActor;
    idempotencyKey: string;
    request: CreateUploadSessionRequest;
    now: string;
  }) {
    return uploadPublishWorkflow.createUploadSession(this.ctx, input);
  }

  async recordUploadedFile(input: {
    workspaceId?: string;
    sessionId: string;
    path: string;
    objectKey?: string;
    sizeBytes?: number;
    sha256?: string;
    uploadedAt: string;
  }) {
    return uploadPublishWorkflow.recordUploadedFile(this.ctx, input);
  }

  async getUploadSession(input: { actor: ApiActor; sessionId: string }) {
    return uploadPublishWorkflow.getUploadSession(this.ctx, input);
  }

  async getUploadSessionState(input: { workspaceId: string; sessionId: string }) {
    return uploadPublishWorkflow.getUploadSessionState(this.ctx, input);
  }

  async finalizeUploadSession(input: {
    actor: ApiActor;
    idempotencyKey: string;
    sessionId: string;
    observedFiles: Array<{ path: string; objectKey: string; sizeBytes: number }>;
    now: string;
  }) {
    return uploadPublishWorkflow.finalizeUploadSession(this.ctx, input);
  }

  async publishRevision(input: {
    actor: ApiActor;
    idempotencyKey: string;
    artifactId: string;
    revisionId: string;
    now: string;
  }) {
    return uploadPublishWorkflow.publishRevision(this.ctx, input);
  }

  async peekPublishWriteGate(input: { actor: ApiActor; artifactId: string; revisionId: string }) {
    return uploadPublishWorkflow.peekPublishWriteGate(this.ctx, input);
  }

  async listRevisions(input: { actor: ApiActor; artifactId: string }) {
    return uploadPublishWorkflow.listRevisions(this.ctx, input);
  }

  async resolveAccessLink(input: { publicId: string; blobScopes: number; contentBaseUrl: string; now?: string }) {
    return accessLinksWorkflow.resolveAccessLink(this.ctx, input);
  }

  async getPublicAgentView(input: { token: string; contentBaseUrl: string }) {
    return uploadPublishWorkflow.getPublicAgentView(this.ctx, input);
  }

  async getAgentView(input: { actor: ApiActor; artifactId: string; revisionId?: string; contentBaseUrl: string }) {
    return uploadPublishWorkflow.getAgentView(this.ctx, input);
  }

  async runCleanup(input: {
    actor: AdminActor;
    idempotencyKey?: string;
    dryRun: boolean;
    batchSize?: number;
    now: string;
  }) {
    return cleanupWorkflow.runCleanup(this.ctx, input);
  }

  async listMemberArtifacts(actor: ApiActor, pagination: { cursor?: string; limit?: number } = {}) {
    return memberArtifactsWorkflow.listMemberArtifacts(this.ctx, actor, pagination);
  }

  async deleteMemberArtifact(input: { actor: ApiActor; idempotencyKey: string; artifactId: string; now?: Date }) {
    return memberArtifactsWorkflow.deleteMemberArtifact(this.ctx, input);
  }

  async updateArtifactDisplayMetadata(input: { actor: ApiActor; artifactId: string; title: string; now?: Date }) {
    return memberArtifactsWorkflow.updateArtifactDisplayMetadata(this.ctx, input);
  }

  async createMemberAccessLink(input: {
    actor: ApiActor;
    idempotencyKey: string;
    artifactId: string;
    type: import("../types.js").AccessLink["type"];
    revisionId?: string | null;
    now?: Date;
  }) {
    return accessLinksWorkflow.createMemberAccessLink(this.ctx, input);
  }

  async listMemberAccessLinks(actor: ApiActor, artifactId: string) {
    return accessLinksWorkflow.listMemberAccessLinks(this.ctx, actor, artifactId);
  }

  async listWorkspaceAccessLinks(actor: ApiActor) {
    return accessLinksWorkflow.listWorkspaceAccessLinks(this.ctx, actor);
  }

  async listWebArtifactAccessLinks(actor: ApiActor, artifactId: string) {
    return accessLinksWorkflow.listWebArtifactAccessLinks(this.ctx, actor, artifactId);
  }

  async setMemberAccessLinkLockdown(input: {
    actor: ApiActor;
    idempotencyKey: string;
    artifactId: string;
    locked: boolean;
    now?: Date;
  }) {
    return accessLinksWorkflow.setMemberAccessLinkLockdown(this.ctx, input);
  }

  async revokeMemberAccessLink(input: { actor: ApiActor; accessLinkId: string; now?: Date }) {
    return accessLinksWorkflow.revokeMemberAccessLink(this.ctx, input);
  }

  async peekArtifactDenylistRetention(artifactId: string) {
    return peekArtifactDenylistRetentionCore(this.ctx, artifactId);
  }

  async peekArtifactPlatformLockdownRetention(artifactId: string) {
    return peekArtifactPlatformLockdownRetentionCore(this.ctx, artifactId);
  }

  async mintMemberAccessLink(input: {
    actor: ApiActor;
    accessLinkId: string;
    appBaseUrl: string;
    signingSecret: string;
    signingKid: number;
    now?: Date;
  }) {
    return accessLinksWorkflow.mintMemberAccessLink(this.ctx, input);
  }

  async listArtifacts(workspaceId?: string, status?: string) {
    return workspaceAdminWorkflow.listArtifacts(this.ctx, workspaceId, status);
  }

  async getArtifactDetail(artifactId: string) {
    return workspaceAdminWorkflow.getArtifactDetail(this.ctx, artifactId);
  }

  async deleteArtifact(input: { actor: AdminActor; idempotencyKey: string; artifactId: string; now?: Date }) {
    return workspaceAdminWorkflow.deleteArtifact(this.ctx, input);
  }

  async listOperationEvents() {
    return workspaceAdminWorkflow.listOperationEvents(this.ctx);
  }

  async forceExpireArtifact(input: { artifactId: string; expiresAt: string }) {
    return workspaceAdminWorkflow.forceExpireArtifact(this.ctx, input);
  }

  async peekIdempotentReplay(input: { actor: ApiActor; operation: string; idempotencyKey: string }) {
    return workspaceAdminWorkflow.peekIdempotentReplay(this.ctx, input);
  }

  async peekWorkspaceCommandReplay(input: { actor: ApiActor; operation: string; idempotencyKey: string }) {
    return workspaceAdminWorkflow.peekWorkspaceCommandReplay(this.ctx, input);
  }
}
