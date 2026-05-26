import { createKeyRingFromVersionedEnv, type KeyRing } from "./key-ring.js";
import { PepperRing } from "./pepper-ring.js";

export function pepperRingFromWorkerEnv(env: {
  API_KEY_PEPPER_V1?: string;
  API_KEY_PEPPER_V2?: string;
  API_KEY_PEPPER_CURRENT_KID?: string;
}): PepperRing | undefined {
  if (!env.API_KEY_PEPPER_V1) {
    return undefined;
  }
  return PepperRing.fromEnv(env);
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
