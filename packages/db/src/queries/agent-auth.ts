import { and, eq, isNull } from "drizzle-orm";
import type { DrizzleDb } from "../postgres/drizzle.js";
import { defineSqlQuerySourceMap } from "../postgres/query-source.js";
import { agentAuthAccessTokens, agentAuthDelegations, agentAuthJtis, agentAuthRegistrations } from "../schema.js";
import type {
  AgentAuthAccessToken,
  AgentAuthDelegation,
  AgentAuthJti,
  AgentAuthRegistration,
  AgentAuthRegistrationStatus,
} from "../types.js";

export const agentAuthQueries = defineSqlQuerySourceMap("packages/db/src/queries/agent-auth.ts", "agentAuthQueries", {
  async insertDelegation(db: DrizzleDb, row: AgentAuthDelegation) {
    await db.insert(agentAuthDelegations).values({
      id: row.id,
      workspaceId: row.workspace_id,
      workspaceMemberId: row.workspace_member_id,
      providerIssuer: row.provider_issuer,
      providerSubject: row.provider_subject,
      audience: row.audience,
      providerClientId: row.provider_client_id,
      email: row.email,
      createdAt: new Date(row.created_at),
      lastSeenAt: new Date(row.last_seen_at),
      revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
    });
  },

  async findActiveDelegation(
    db: DrizzleDb,
    input: { providerIssuer: string; providerSubject: string; audience: string },
  ): Promise<AgentAuthDelegation | null> {
    const rows = await db
      .select()
      .from(agentAuthDelegations)
      .where(
        and(
          eq(agentAuthDelegations.providerIssuer, input.providerIssuer),
          eq(agentAuthDelegations.providerSubject, input.providerSubject),
          eq(agentAuthDelegations.audience, input.audience),
          isNull(agentAuthDelegations.revokedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? mapDelegation(row) : null;
  },

  async findDelegationById(db: DrizzleDb, id: string): Promise<AgentAuthDelegation | null> {
    const rows = await db.select().from(agentAuthDelegations).where(eq(agentAuthDelegations.id, id)).limit(1);
    const row = rows[0];
    return row ? mapDelegation(row) : null;
  },

  async updateDelegationSeen(db: DrizzleDb, id: string, input: { email: string; lastSeenAt: string }) {
    await db
      .update(agentAuthDelegations)
      .set({ email: input.email, lastSeenAt: new Date(input.lastSeenAt) })
      .where(eq(agentAuthDelegations.id, id));
  },

  async revokeActiveDelegation(
    db: DrizzleDb,
    input: { providerIssuer: string; providerSubject: string; audience: string; revokedAt: string },
  ): Promise<AgentAuthDelegation | null> {
    const rows = await db
      .update(agentAuthDelegations)
      .set({ revokedAt: new Date(input.revokedAt) })
      .where(
        and(
          eq(agentAuthDelegations.providerIssuer, input.providerIssuer),
          eq(agentAuthDelegations.providerSubject, input.providerSubject),
          eq(agentAuthDelegations.audience, input.audience),
          isNull(agentAuthDelegations.revokedAt),
        ),
      )
      .returning();
    const row = rows[0];
    return row ? mapDelegation(row) : null;
  },

  async insertRegistration(db: DrizzleDb, row: AgentAuthRegistration) {
    await db.insert(agentAuthRegistrations).values({
      id: row.id,
      registrationType: row.registration_type,
      delegationId: row.delegation_id,
      workspaceId: row.workspace_id,
      workspaceMemberId: row.workspace_member_id,
      providerIssuer: row.provider_issuer,
      providerSubject: row.provider_subject,
      audience: row.audience,
      providerClientId: row.provider_client_id,
      email: row.email,
      status: row.status,
      claimTokenId: row.claim_token_id,
      claimTokenHash: row.claim_token_hash,
      claimAttemptTokenHash: row.claim_attempt_token_hash,
      userCodeHash: row.user_code_hash,
      claimExpiresAt: row.claim_expires_at ? new Date(row.claim_expires_at) : null,
      claimAttemptExpiresAt: row.claim_attempt_expires_at ? new Date(row.claim_attempt_expires_at) : null,
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
      expiresAt: new Date(row.expires_at),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    });
  },

  async findRegistrationById(db: DrizzleDb, id: string): Promise<AgentAuthRegistration | null> {
    const rows = await db.select().from(agentAuthRegistrations).where(eq(agentAuthRegistrations.id, id)).limit(1);
    const row = rows[0];
    return row ? mapRegistration(row) : null;
  },

  async findRegistrationByClaimTokenHash(
    db: DrizzleDb,
    claimTokenHash: Uint8Array,
  ): Promise<AgentAuthRegistration | null> {
    const rows = await db
      .select()
      .from(agentAuthRegistrations)
      .where(eq(agentAuthRegistrations.claimTokenHash, claimTokenHash))
      .limit(1);
    const row = rows[0];
    return row ? mapRegistration(row) : null;
  },

  async findRegistrationByClaimAttemptTokenHash(
    db: DrizzleDb,
    claimAttemptTokenHash: Uint8Array,
  ): Promise<AgentAuthRegistration | null> {
    const rows = await db
      .select()
      .from(agentAuthRegistrations)
      .where(eq(agentAuthRegistrations.claimAttemptTokenHash, claimAttemptTokenHash))
      .limit(1);
    const row = rows[0];
    return row ? mapRegistration(row) : null;
  },

  async markRegistrationVerified(
    db: DrizzleDb,
    id: string,
    input: { delegationId: string; completedAt: string; updatedAt: string },
  ): Promise<AgentAuthRegistration | null> {
    const rows = await db
      .update(agentAuthRegistrations)
      .set({
        delegationId: input.delegationId,
        status: "verified",
        completedAt: new Date(input.completedAt),
        updatedAt: new Date(input.updatedAt),
      })
      .where(eq(agentAuthRegistrations.id, id))
      .returning();
    const row = rows[0];
    return row ? mapRegistration(row) : null;
  },

  async markAnonymousClaimPending(
    db: DrizzleDb,
    id: string,
    input: {
      claimAttemptTokenHash: Uint8Array;
      userCodeHash: Uint8Array;
      claimAttemptExpiresAt: string;
      updatedAt: string;
    },
  ): Promise<AgentAuthRegistration | null> {
    const rows = await db
      .update(agentAuthRegistrations)
      .set({
        status: "anonymous_claim_pending",
        claimAttemptTokenHash: input.claimAttemptTokenHash,
        userCodeHash: input.userCodeHash,
        claimAttemptExpiresAt: new Date(input.claimAttemptExpiresAt),
        updatedAt: new Date(input.updatedAt),
      })
      .where(eq(agentAuthRegistrations.id, id))
      .returning();
    const row = rows[0];
    return row ? mapRegistration(row) : null;
  },

  async markAnonymousRegistrationVerified(
    db: DrizzleDb,
    id: string,
    input: { workspaceId: string; workspaceMemberId: string; email: string; completedAt: string; updatedAt: string },
  ): Promise<AgentAuthRegistration | null> {
    const rows = await db
      .update(agentAuthRegistrations)
      .set({
        workspaceId: input.workspaceId,
        workspaceMemberId: input.workspaceMemberId,
        email: input.email,
        status: "verified",
        completedAt: new Date(input.completedAt),
        updatedAt: new Date(input.updatedAt),
      })
      .where(eq(agentAuthRegistrations.id, id))
      .returning();
    const row = rows[0];
    return row ? mapRegistration(row) : null;
  },

  async insertJti(db: DrizzleDb, row: AgentAuthJti): Promise<boolean> {
    const inserted = await db
      .insert(agentAuthJtis)
      .values({
        providerIssuer: row.provider_issuer,
        jti: row.jti,
        expiresAt: new Date(row.expires_at),
        createdAt: new Date(row.created_at),
      })
      .onConflictDoNothing()
      .returning({ jti: agentAuthJtis.jti });
    return inserted.length > 0;
  },

  async insertAccessToken(db: DrizzleDb, row: AgentAuthAccessToken) {
    await db.insert(agentAuthAccessTokens).values({
      apiKeyId: row.api_key_id,
      registrationId: row.registration_id,
      delegationId: row.delegation_id,
      issuedAt: new Date(row.issued_at),
    });
  },

  async findAccessTokenByApiKeyId(db: DrizzleDb, apiKeyId: string): Promise<AgentAuthAccessToken | null> {
    const rows = await db
      .select()
      .from(agentAuthAccessTokens)
      .where(eq(agentAuthAccessTokens.apiKeyId, apiKeyId))
      .limit(1);
    const row = rows[0];
    return row ? mapAccessToken(row) : null;
  },

  async listAccessTokensForDelegation(db: DrizzleDb, delegationId: string): Promise<AgentAuthAccessToken[]> {
    const rows = await db
      .select()
      .from(agentAuthAccessTokens)
      .where(eq(agentAuthAccessTokens.delegationId, delegationId));
    return rows.map(mapAccessToken);
  },
});

function mapDelegation(row: typeof agentAuthDelegations.$inferSelect): AgentAuthDelegation {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    workspace_member_id: row.workspaceMemberId,
    provider_issuer: row.providerIssuer,
    provider_subject: row.providerSubject,
    audience: row.audience,
    provider_client_id: row.providerClientId,
    email: row.email,
    created_at: row.createdAt.toISOString(),
    last_seen_at: row.lastSeenAt.toISOString(),
    revoked_at: row.revokedAt ? row.revokedAt.toISOString() : null,
  };
}

function mapRegistration(row: typeof agentAuthRegistrations.$inferSelect): AgentAuthRegistration {
  return {
    id: row.id,
    registration_type: row.registrationType,
    delegation_id: row.delegationId,
    workspace_id: row.workspaceId,
    workspace_member_id: row.workspaceMemberId,
    provider_issuer: row.providerIssuer,
    provider_subject: row.providerSubject,
    audience: row.audience,
    provider_client_id: row.providerClientId,
    email: row.email,
    status: row.status as AgentAuthRegistrationStatus,
    claim_token_id: row.claimTokenId,
    claim_token_hash: row.claimTokenHash,
    claim_attempt_token_hash: row.claimAttemptTokenHash,
    user_code_hash: row.userCodeHash,
    claim_expires_at: row.claimExpiresAt ? row.claimExpiresAt.toISOString() : null,
    claim_attempt_expires_at: row.claimAttemptExpiresAt ? row.claimAttemptExpiresAt.toISOString() : null,
    completed_at: row.completedAt ? row.completedAt.toISOString() : null,
    expires_at: row.expiresAt.toISOString(),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function mapAccessToken(row: typeof agentAuthAccessTokens.$inferSelect): AgentAuthAccessToken {
  return {
    api_key_id: row.apiKeyId,
    registration_id: row.registrationId,
    delegation_id: row.delegationId,
    issued_at: row.issuedAt.toISOString(),
  };
}
