import type { BytePurgeMessage } from "@agent-paste/contracts";
import { storageEnvSegment } from "@agent-paste/db";

export type PurgeScope = Pick<BytePurgeMessage, "workspace_id" | "artifact_id" | "prefixes">;

const ENV_SCOPE_PATTERN = /^env\/([^/]+)\/workspaces\/([^/]+)\//;

export class BytePurgePrefixEnvMismatchError extends Error {
  readonly prefix: string;
  readonly prefixEnv: string;
  readonly expectedEnv: string;

  constructor(prefix: string, prefixEnv: string, expectedEnv: string) {
    super("byte_purge_prefix_env_mismatch");
    this.name = "BytePurgePrefixEnvMismatchError";
    this.prefix = prefix;
    this.prefixEnv = prefixEnv;
    this.expectedEnv = expectedEnv;
  }
}

// Safety property: a message may only purge keys belonging to its own
// artifact. Revision files use artifact-scoped keys; derived bundles use
// env-scoped keys (ADR 0021), which must pin env, workspace, and artifact.
export function assertArtifactScopedPrefixes(payload: PurgeScope, agentPasteEnv?: string): void {
  if (payload.prefixes.length === 0) {
    throw new Error("byte_purge_prefix_outside_artifact_scope");
  }

  const expectedEnv = storageEnvSegment(agentPasteEnv);
  for (const prefix of payload.prefixes) {
    const envScope = ENV_SCOPE_PATTERN.exec(prefix);
    if (envScope !== null) {
      const prefixEnv = envScope[1];
      if (!prefixEnv) {
        throw new Error("byte_purge_prefix_outside_artifact_scope");
      }
      if (prefixEnv !== expectedEnv) {
        throw new BytePurgePrefixEnvMismatchError(prefix, prefixEnv, expectedEnv);
      }
    }

    if (!isArtifactScopedPrefix(payload, prefix, expectedEnv)) {
      throw new Error("byte_purge_prefix_outside_artifact_scope");
    }
  }
}

function isArtifactScopedPrefix(payload: PurgeScope, prefix: string, expectedEnv: string): boolean {
  const artifactPrefix = `artifacts/${payload.artifact_id}/`;
  if (prefix.startsWith(artifactPrefix)) {
    return true;
  }

  const envScope = ENV_SCOPE_PATTERN.exec(prefix);
  return (
    envScope !== null &&
    envScope[1] === expectedEnv &&
    envScope[2] === payload.workspace_id &&
    prefix.slice(envScope[0].length).startsWith(artifactPrefix)
  );
}
