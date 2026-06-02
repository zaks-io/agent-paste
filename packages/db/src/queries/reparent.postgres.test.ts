import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { reparentTenantContent } from "./reparent.js";

const sourceWorkspaceId = "11111111-1111-1111-1111-111111111111";
const destinationWorkspaceId = "22222222-2222-2222-2222-222222222222";

describe("reparentTenantContent", () => {
  let client: PGlite;

  beforeAll(async () => {
    client = new PGlite();
    await client.exec(`
      create table workspaces (
        id uuid primary key,
        name text not null,
        contact_email text,
        plan text not null default 'free',
        plan_operator_override_at timestamptz,
        claimed_at timestamptz,
        auto_deletion_days integer not null default 30,
        revision_retention_days integer,
        created_at timestamptz not null,
        updated_at timestamptz not null
      );
      create table artifacts (
        id text primary key,
        workspace_id uuid not null references workspaces(id),
        revision_id text,
        status text not null,
        title text not null,
        entrypoint text not null,
        file_count integer not null,
        size_bytes bigint not null,
        expires_at timestamptz not null,
        pinned_at timestamptz,
        created_by_type text not null,
        created_by_id text not null,
        access_link_lockdown_at timestamptz,
        deleted_at timestamptz,
        delete_reason text,
        created_at timestamptz not null,
        updated_at timestamptz not null
      );
      create unique index artifacts_workspace_id_unique on artifacts(workspace_id, id);
      create table revisions (
        id text primary key,
        workspace_id uuid not null references workspaces(id),
        artifact_id text not null,
        revision_number integer,
        status text not null,
        entrypoint text not null,
        render_mode text not null,
        file_count integer not null,
        size_bytes bigint not null,
        bundle_status text not null,
        bundle_status_updated_at timestamptz,
        bundle_size_bytes bigint,
        created_by_type text not null,
        created_by_id text not null,
        created_at timestamptz not null,
        published_at timestamptz
      );
      create unique index revisions_workspace_artifact_id_unique
        on revisions(workspace_id, artifact_id, id);
      create table access_links (
        id text primary key,
        workspace_id uuid not null references workspaces(id),
        artifact_id text not null,
        revision_id text,
        public_id text not null,
        type text not null,
        scopes_bitmask integer not null,
        expires_at timestamptz,
        created_by_type text not null,
        created_by_id text not null,
        created_at timestamptz not null,
        revoked_at timestamptz,
        constraint access_links_artifact_fk
          foreign key (workspace_id, artifact_id)
          references artifacts(workspace_id, id) on delete cascade
          deferrable initially deferred,
        constraint access_links_revision_fk
          foreign key (workspace_id, artifact_id, revision_id)
          references revisions(workspace_id, artifact_id, id) on delete cascade
          deferrable initially deferred
      );
      create table safety_warnings (
        id text primary key,
        workspace_id uuid not null references workspaces(id),
        artifact_id text not null,
        revision_id text not null,
        scanner_id text not null,
        scanner_version text not null,
        code text not null,
        severity text not null,
        scope text not null,
        file_path text,
        message text not null,
        created_at timestamptz not null,
        constraint safety_warnings_revision_fk
          foreign key (workspace_id, artifact_id, revision_id)
          references revisions(workspace_id, artifact_id, id) on delete cascade
          deferrable initially deferred
      );
      create table upload_sessions (
        id text primary key,
        workspace_id uuid not null references workspaces(id),
        artifact_id text not null,
        revision_id text not null,
        status text not null,
        entrypoint text not null,
        expires_at timestamptz not null,
        created_by_type text not null,
        created_by_id text not null,
        created_at timestamptz not null,
        finalized_at timestamptz
      );
      create table upload_session_files (
        workspace_id uuid not null references workspaces(id),
        upload_session_id text not null references upload_sessions(id) on delete cascade,
        path text not null,
        size_bytes bigint not null,
        served_content_type text not null,
        r2_key text not null,
        uploaded_at timestamptz,
        put_url_expires_at timestamptz not null,
        primary key (upload_session_id, path)
      );
      create table artifact_files (
        workspace_id uuid not null references workspaces(id),
        artifact_id text not null,
        revision_id text not null,
        path text not null,
        size_bytes bigint not null,
        served_content_type text not null,
        r2_key text not null,
        uploaded_at timestamptz,
        primary key (artifact_id, revision_id, path)
      );
    `);
    const now = "2026-01-01T00:00:00.000Z";
    await client.exec(`
      insert into workspaces (id, name, claimed_at, auto_deletion_days, created_at, updated_at)
      values
        ('${sourceWorkspaceId}', 'Ephemeral', null, 1, '${now}', '${now}'),
        ('${destinationWorkspaceId}', 'Personal', '${now}', 30, '${now}', '${now}');
      insert into artifacts (id, workspace_id, revision_id, status, title, entrypoint, file_count, size_bytes, expires_at, created_by_type, created_by_id, created_at, updated_at)
      values ('art_reparent', '${sourceWorkspaceId}', 'rev_reparent', 'active', 'Claim me', 'index.html', 1, 12, '2026-01-02T00:00:00.000Z', 'api_key', 'key_ephemeral', '${now}', '${now}');
      insert into revisions (id, workspace_id, artifact_id, revision_number, status, entrypoint, render_mode, file_count, size_bytes, bundle_status, created_by_type, created_by_id, created_at, published_at)
      values ('rev_reparent', '${sourceWorkspaceId}', 'art_reparent', 1, 'published', 'index.html', 'html', 1, 12, 'disabled', 'api_key', 'key_ephemeral', '${now}', '${now}');
      insert into access_links (id, workspace_id, artifact_id, revision_id, public_id, type, scopes_bitmask, created_by_type, created_by_id, created_at)
      values ('al_reparent', '${sourceWorkspaceId}', 'art_reparent', 'rev_reparent', '0123456789ABCDEF', 'revision', 0, 'api_key', 'key_ephemeral', '${now}');
      insert into safety_warnings (id, workspace_id, artifact_id, revision_id, scanner_id, scanner_version, code, severity, scope, message, created_at)
      values ('sw_reparent', '${sourceWorkspaceId}', 'art_reparent', 'rev_reparent', 'ephemeral_tier', '1', 'script_disabled', 'info', 'artifact', 'Ephemeral tier', '${now}');
      insert into upload_sessions (id, workspace_id, artifact_id, revision_id, status, entrypoint, expires_at, created_by_type, created_by_id, created_at)
      values ('us_reparent', '${sourceWorkspaceId}', 'art_reparent', 'rev_reparent', 'pending', 'index.html', '2026-01-03T00:00:00.000Z', 'api_key', 'key_ephemeral', '${now}');
      insert into upload_session_files (workspace_id, upload_session_id, path, size_bytes, served_content_type, r2_key, put_url_expires_at)
      values ('${sourceWorkspaceId}', 'us_reparent', 'index.html', 12, 'text/html', 'r2/key', '2026-01-03T00:00:00.000Z');
    `);
  }, 30_000);

  function createExecutor() {
    return {
      query: async <Row = Record<string, unknown>>(queryText: string, params?: readonly unknown[]) => {
        const response = await client.query<Row>(queryText, params as never[]);
        return { rows: response.rows };
      },
      transaction: async <T>(run: (tx: ReturnType<typeof createExecutor>) => Promise<T>) => {
        await client.exec("begin");
        try {
          const result = await run(createExecutor());
          await client.exec("commit");
          return result;
        } catch (error) {
          await client.exec("rollback");
          throw error;
        }
      },
    };
  }

  it("moves tenant rows and extends artifact expiry", async () => {
    const result = await reparentTenantContent(createExecutor(), {
      fromWorkspaceId: sourceWorkspaceId,
      toWorkspaceId: destinationWorkspaceId,
      updatedAt: "2026-01-03T00:00:00.000Z",
      minArtifactExpiresAt: "2026-02-01T00:00:00.000Z",
    });

    expect(result.artifact_ids).toEqual(["art_reparent"]);
    const artifact = await client.query<{ workspace_id: string; expires_at: string }>(
      "select workspace_id, expires_at from artifacts where id = $1",
      ["art_reparent"],
    );
    expect(artifact.rows[0]?.workspace_id).toBe(destinationWorkspaceId);
    expect(new Date(artifact.rows[0]?.expires_at ?? "").toISOString()).toBe("2026-02-01T00:00:00.000Z");
  });

  it("reparents composite-FK child rows and upload session files", async () => {
    const childSourceWorkspaceId = "44444444-4444-4444-4444-444444444444";
    const now = "2026-01-01T00:00:00.000Z";
    await client.exec(`
      insert into workspaces (id, name, claimed_at, auto_deletion_days, created_at, updated_at)
      values ('${childSourceWorkspaceId}', 'Ephemeral child rows', null, 1, '${now}', '${now}');
      insert into artifacts (id, workspace_id, revision_id, status, title, entrypoint, file_count, size_bytes, expires_at, created_by_type, created_by_id, created_at, updated_at)
      values ('art_child', '${childSourceWorkspaceId}', 'rev_child', 'active', 'Child rows', 'index.html', 1, 12, '2026-01-02T00:00:00.000Z', 'api_key', 'key_ephemeral', '${now}', '${now}');
      insert into revisions (id, workspace_id, artifact_id, revision_number, status, entrypoint, render_mode, file_count, size_bytes, bundle_status, created_by_type, created_by_id, created_at, published_at)
      values ('rev_child', '${childSourceWorkspaceId}', 'art_child', 1, 'published', 'index.html', 'html', 1, 12, 'disabled', 'api_key', 'key_ephemeral', '${now}', '${now}');
      insert into access_links (id, workspace_id, artifact_id, revision_id, public_id, type, scopes_bitmask, created_by_type, created_by_id, created_at)
      values ('al_child', '${childSourceWorkspaceId}', 'art_child', 'rev_child', 'FEDCBA9876543210', 'revision', 0, 'api_key', 'key_ephemeral', '${now}');
      insert into safety_warnings (id, workspace_id, artifact_id, revision_id, scanner_id, scanner_version, code, severity, scope, message, created_at)
      values ('sw_child', '${childSourceWorkspaceId}', 'art_child', 'rev_child', 'ephemeral_tier', '1', 'script_disabled', 'info', 'artifact', 'Ephemeral tier', '${now}');
      insert into upload_sessions (id, workspace_id, artifact_id, revision_id, status, entrypoint, expires_at, created_by_type, created_by_id, created_at)
      values ('us_child', '${childSourceWorkspaceId}', 'art_child', 'rev_child', 'pending', 'index.html', '2026-01-03T00:00:00.000Z', 'api_key', 'key_ephemeral', '${now}');
      insert into upload_session_files (workspace_id, upload_session_id, path, size_bytes, served_content_type, r2_key, put_url_expires_at)
      values ('${childSourceWorkspaceId}', 'us_child', 'index.html', 12, 'text/html', 'r2/key', '2026-01-03T00:00:00.000Z');
    `);

    await reparentTenantContent(createExecutor(), {
      fromWorkspaceId: childSourceWorkspaceId,
      toWorkspaceId: destinationWorkspaceId,
      updatedAt: "2026-01-03T00:00:00.000Z",
      minArtifactExpiresAt: "2026-02-01T00:00:00.000Z",
    });

    const accessLink = await client.query<{ workspace_id: string }>(
      "select workspace_id from access_links where id = 'al_child'",
    );
    const warning = await client.query<{ workspace_id: string }>(
      "select workspace_id from safety_warnings where id = 'sw_child'",
    );
    const uploadFile = await client.query<{ workspace_id: string }>(
      "select workspace_id from upload_session_files where upload_session_id = 'us_child'",
    );
    expect(accessLink.rows[0]?.workspace_id).toBe(destinationWorkspaceId);
    expect(warning.rows[0]?.workspace_id).toBe(destinationWorkspaceId);
    expect(uploadFile.rows[0]?.workspace_id).toBe(destinationWorkspaceId);
  });

  it("returns an empty artifact list when the source workspace has no artifacts", async () => {
    const emptyWorkspaceId = "33333333-3333-3333-3333-333333333333";
    await client.exec(`
      insert into workspaces (id, name, claimed_at, auto_deletion_days, created_at, updated_at)
      values ('${emptyWorkspaceId}', 'Empty', null, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    `);
    await expect(
      reparentTenantContent(createExecutor(), {
        fromWorkspaceId: emptyWorkspaceId,
        toWorkspaceId: destinationWorkspaceId,
        updatedAt: "2026-01-03T00:00:00.000Z",
        minArtifactExpiresAt: "2026-02-01T00:00:00.000Z",
      }),
    ).resolves.toEqual({ artifact_ids: [] });
  });
});
