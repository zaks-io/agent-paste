import type { AccessLinkPublicId, ArtifactId } from "@agent-paste/contracts";
import type { ApiServiceBinding } from "./authorize.js";
import { authorizeLiveUpdate } from "./authorize.js";

export type { ApiServiceBinding };

export type LiveConnectionAuth =
  | { kind: "dashboard"; authorization: string }
  | { kind: "access_link"; public_id: AccessLinkPublicId; blob: string };

function authorizeOptions(options: { streamInternalSecret?: string }) {
  return options.streamInternalSecret ? { streamInternalSecret: options.streamInternalSecret } : {};
}

export async function resignLiveUpdatePointer(
  api: ApiServiceBinding,
  auth: LiveConnectionAuth,
  artifactId: ArtifactId,
  options: { streamInternalSecret?: string },
) {
  const authOptions = authorizeOptions(options);
  if (auth.kind === "dashboard") {
    return authorizeLiveUpdate(
      api,
      { kind: "dashboard", artifact_id: artifactId },
      { authorization: auth.authorization, ...authOptions },
    );
  }
  return authorizeLiveUpdate(api, { kind: "access_link", public_id: auth.public_id, blob: auth.blob }, authOptions);
}

export function parseConnectAuth(value: unknown): LiveConnectionAuth | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const auth = value as { kind?: unknown };
  if (auth.kind === "dashboard" && typeof (auth as { authorization?: unknown }).authorization === "string") {
    return { kind: "dashboard", authorization: (auth as { authorization: string }).authorization };
  }
  if (
    auth.kind === "access_link" &&
    typeof (auth as { public_id?: unknown }).public_id === "string" &&
    typeof (auth as { blob?: unknown }).blob === "string"
  ) {
    return {
      kind: "access_link",
      public_id: (auth as { public_id: AccessLinkPublicId }).public_id,
      blob: (auth as { blob: string }).blob,
    };
  }
  return null;
}
