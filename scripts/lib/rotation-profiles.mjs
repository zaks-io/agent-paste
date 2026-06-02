/** Keep in sync with `packages/rotation/src/automation.ts` VERSIONED_SECRET_PROFILES. */

export const VERSIONED_SECRET_PROFILES = {
  "content-signing": {
    id: "content-signing",
    baseSecretName: "CONTENT_SIGNING_SECRET",
    secondarySecretName: "CONTENT_SIGNING_SECRET_V2",
    kidVarName: "CONTENT_SIGNING_KID",
    bindings: [
      { app: "api", worker: "agent-paste-api" },
      { app: "upload", worker: "agent-paste-upload" },
      { app: "content", worker: "agent-paste-content" },
      { app: "jobs", worker: "agent-paste-jobs" },
    ],
    drainHint: "Wait at least the longest content-token TTL (default 15 minutes) before drop so kid 1 tokens expire.",
  },
  "upload-signing": {
    id: "upload-signing",
    baseSecretName: "UPLOAD_SIGNING_SECRET",
    secondarySecretName: "UPLOAD_SIGNING_SECRET_V2",
    kidVarName: "UPLOAD_SIGNING_KID",
    bindings: [{ app: "upload", worker: "agent-paste-upload" }],
    drainHint: "Wait for in-flight signed upload URLs to expire (default UPLOAD_URL_TTL_SECONDS is 900) before drop.",
  },
  "api-key-pepper": {
    id: "api-key-pepper",
    baseSecretName: "API_KEY_PEPPER_V1",
    secondarySecretName: "API_KEY_PEPPER_V2",
    kidVarName: "API_KEY_PEPPER_CURRENT_KID",
    bindings: [
      { app: "api", worker: "agent-paste-api" },
      { app: "upload", worker: "agent-paste-upload" },
    ],
    drainHint: "Wait until no API Keys with pepper_kid=1 are required, or reissue long-lived keys, before drop.",
  },
  "artifact-bytes-encryption": {
    id: "artifact-bytes-encryption",
    baseSecretName: "ARTIFACT_BYTES_ENCRYPTION_KEY",
    secondarySecretName: "ARTIFACT_BYTES_ENCRYPTION_KEY_V2",
    kidVarName: "ARTIFACT_BYTES_ENCRYPTION_KID",
    bindings: [
      { app: "upload", worker: "agent-paste-upload" },
      { app: "content", worker: "agent-paste-content" },
      { app: "jobs", worker: "agent-paste-jobs" },
    ],
    drainHint:
      "Existing R2 ciphertext keeps its original enc_kid; only drop after no reads/writes still need the retired kid.",
  },
};

export const ROTATION_AGENT_OPERATOR_ID = "rotation-agent@platform";

export const PROFILE_IDS = Object.keys(VERSIONED_SECRET_PROFILES);

/** Profiles that persist kid into stored records (must not relabel kid 2 → 1 on drop). */
export function profilePersistsKidInRecords(profileId) {
  return profileId === "api-key-pepper" || profileId === "artifact-bytes-encryption";
}
