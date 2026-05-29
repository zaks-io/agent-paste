import { createKeyRingFromVersionedEnv, KeyRing, type KeyRingEntry } from "./key-ring.js";
import { parseKidLabel } from "./kid.js";
import { PepperRing } from "./pepper-ring.js";

export function hasApiKeyPepperBinding(env: { API_KEY_PEPPER_V1?: string; API_KEY_PEPPER_V2?: string }): boolean {
  return Boolean(env.API_KEY_PEPPER_V1 || env.API_KEY_PEPPER_V2);
}

export function pepperRingFromWorkerEnv(env: {
  API_KEY_PEPPER_V1?: string;
  API_KEY_PEPPER_V2?: string;
  API_KEY_PEPPER_CURRENT_KID?: string;
}): PepperRing | undefined {
  if (!hasApiKeyPepperBinding(env)) {
    return undefined;
  }
  return PepperRing.fromEnv(env);
}

export function resolveApiKeyPepperMaterial(env: {
  API_KEY_PEPPER_V1?: string;
  API_KEY_PEPPER_V2?: string;
  API_KEY_PEPPER_CURRENT_KID?: string;
}): string | undefined {
  const ring = pepperRingFromWorkerEnv(env);
  if (ring) {
    return ring.currentPepper();
  }
  return env.API_KEY_PEPPER_V1;
}

export function pepperRingVerifySecrets(ring: PepperRing): string[] {
  return ring.verifyKids
    .map((kid) => ring.pepperForKid(kid))
    .filter((pepper): pepper is string => typeof pepper === "string");
}

export function contentSigningRingFromEnv(env: {
  CONTENT_SIGNING_SECRET?: string;
  CONTENT_SIGNING_SECRET_V2?: string;
  CONTENT_SIGNING_KID?: string;
}): KeyRing | undefined {
  if (!env.CONTENT_SIGNING_SECRET) {
    return undefined;
  }
  return createKeyRingFromVersionedEnv({
    baseName: "CONTENT_SIGNING_SECRET",
    kidVarName: "CONTENT_SIGNING_KID",
    env: env as Record<string, string | undefined>,
  });
}

export function uploadSigningRingFromEnv(env: {
  UPLOAD_SIGNING_SECRET?: string;
  UPLOAD_SIGNING_SECRET_V2?: string;
  UPLOAD_SIGNING_KID?: string;
}): KeyRing | undefined {
  if (!env.UPLOAD_SIGNING_SECRET) {
    return undefined;
  }
  return createKeyRingFromVersionedEnv({
    baseName: "UPLOAD_SIGNING_SECRET",
    kidVarName: "UPLOAD_SIGNING_KID",
    env: env as Record<string, string | undefined>,
  });
}

export function hasArtifactBytesEncryptionBinding(env: {
  ARTIFACT_BYTES_ENCRYPTION_KEY?: string;
  ARTIFACT_BYTES_ENCRYPTION_KEY_V2?: string;
}): boolean {
  return Boolean(env.ARTIFACT_BYTES_ENCRYPTION_KEY || env.ARTIFACT_BYTES_ENCRYPTION_KEY_V2);
}

export function artifactBytesEncryptionRingFromEnv(env: {
  ARTIFACT_BYTES_ENCRYPTION_KEY?: string;
  ARTIFACT_BYTES_ENCRYPTION_KEY_V2?: string;
  ARTIFACT_BYTES_ENCRYPTION_KID?: string;
}): KeyRing | undefined {
  if (!hasArtifactBytesEncryptionBinding(env)) {
    return undefined;
  }
  return createKeyRingFromVersionedEnv({
    baseName: "ARTIFACT_BYTES_ENCRYPTION_KEY",
    kidVarName: "ARTIFACT_BYTES_ENCRYPTION_KID",
    env: env as Record<string, string | undefined>,
  });
}

export function accessLinkSigningRingFromEnv(env: {
  ACCESS_LINK_SIGNING_KEY_V1?: string;
  ACCESS_LINK_SIGNING_KEY_V2?: string;
  ACCESS_LINK_SIGNING_KID?: string;
}): KeyRing | undefined {
  if (!env.ACCESS_LINK_SIGNING_KEY_V1) {
    return undefined;
  }
  const signingKid = parseKidLabel(env.ACCESS_LINK_SIGNING_KID, 1);
  const entries: KeyRingEntry[] = [{ kid: 1, secret: env.ACCESS_LINK_SIGNING_KEY_V1 }];
  if (env.ACCESS_LINK_SIGNING_KEY_V2) {
    entries.push({ kid: 2, secret: env.ACCESS_LINK_SIGNING_KEY_V2 });
  }
  return KeyRing.fromEntries(signingKid, entries);
}
