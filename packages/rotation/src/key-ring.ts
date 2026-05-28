import { parseKidLabel } from "./kid.js";

export type KeyRingEntry = {
  kid: number;
  secret: string;
};

/**
 * Holds one or more `{ kid → secret }` entries with an explicit overlap window.
 * Minters use {@link signingKid}; verifiers accept every kid in {@link verifyKids}.
 */
export class KeyRing {
  private readonly secrets = new Map<number, string>();
  private signingKidValue: number;
  private verifyKidSet: Set<number>;

  private constructor(signingKid: number, verifyKids: Iterable<number>, entries: KeyRingEntry[]) {
    this.signingKidValue = signingKid;
    this.verifyKidSet = new Set(verifyKids);
    for (const entry of entries) {
      this.secrets.set(entry.kid, entry.secret);
    }
    this.assertConsistent();
  }

  static single(secret: string, kid = 1): KeyRing {
    return new KeyRing(kid, [kid], [{ kid, secret }]);
  }

  static fromEntries(signingKid: number, entries: KeyRingEntry[]): KeyRing {
    const verifyKids = entries.map((entry) => entry.kid);
    return new KeyRing(signingKid, verifyKids, entries);
  }

  get signingKid(): number {
    return this.signingKidValue;
  }

  get verifyKids(): readonly number[] {
    return [...this.verifyKidSet].sort((left, right) => left - right);
  }

  signingSecret(): string {
    const secret = this.secrets.get(this.signingKidValue);
    if (!secret) {
      throw new Error(`key_ring_missing_signing_secret:${this.signingKidValue}`);
    }
    return secret;
  }

  secretForKid(kid: number): string | undefined {
    return this.secrets.get(kid);
  }

  verifyEntries(): KeyRingEntry[] {
    return this.verifyKids
      .map((kid) => {
        const secret = this.secrets.get(kid);
        return secret ? { kid, secret } : null;
      })
      .filter((entry): entry is KeyRingEntry => entry !== null);
  }

  /** Stage a new kid for verify-only (verifier Workers get the new secret first). */
  stageVerifyKey(kid: number, secret: string): void {
    if (this.secrets.has(kid)) {
      throw new Error(`key_ring_kid_already_present:${kid}`);
    }
    this.secrets.set(kid, secret);
    this.verifyKidSet.add(kid);
    this.assertConsistent();
  }

  /** Flip minters to sign with `kid` while keeping prior verify kids. */
  promoteSigningKid(kid: number): void {
    if (!this.secrets.has(kid)) {
      throw new Error(`key_ring_unknown_kid:${kid}`);
    }
    if (!this.verifyKidSet.has(kid)) {
      throw new Error(`key_ring_kid_not_verifiable:${kid}`);
    }
    this.signingKidValue = kid;
    this.assertConsistent();
  }

  /** Remove a retired kid after the overlap drain window. */
  dropKid(kid: number): void {
    if (kid === this.signingKidValue) {
      throw new Error(`key_ring_cannot_drop_active_signing_kid:${kid}`);
    }
    if (!this.secrets.delete(kid)) {
      throw new Error(`key_ring_unknown_kid:${kid}`);
    }
    this.verifyKidSet.delete(kid);
    this.assertConsistent();
  }

  overlapKidCount(): number {
    return this.verifyKidSet.size;
  }

  /** Emergency cutover: single active kid with a new secret (no overlap). */
  replaceSigningSecret(secret: string, kid = 1): void {
    this.signingKidValue = kid;
    this.verifyKidSet = new Set([kid]);
    this.secrets.clear();
    this.secrets.set(kid, secret);
    this.assertConsistent();
  }

  private assertConsistent(): void {
    if (!this.secrets.has(this.signingKidValue)) {
      throw new Error(`key_ring_inconsistent_signing_kid:${this.signingKidValue}`);
    }
    for (const kid of this.verifyKidSet) {
      if (!this.secrets.has(kid)) {
        throw new Error(`key_ring_inconsistent_verify_kid:${kid}`);
      }
    }
  }
}

export type VersionedSecretEnv = Record<string, string | undefined>;

/**
 * Builds a ring from `BASE_SECRET` (kid 1) and optional `BASE_SECRET_V2`, with
 * `KID_VAR` naming the active signing kid (`v1` default).
 */
export function createKeyRingFromVersionedEnv(input: {
  baseName: string;
  kidVarName: string;
  env: VersionedSecretEnv;
  defaultSigningKid?: number;
}): KeyRing {
  const primary = input.env[input.baseName];
  if (!primary) {
    throw new Error(`key_ring_missing_env:${input.baseName}`);
  }
  const signingKid = parseKidLabel(input.env[input.kidVarName], input.defaultSigningKid ?? 1);
  const entries: KeyRingEntry[] = [{ kid: 1, secret: primary }];
  const secondary = input.env[`${input.baseName}_V2`];
  if (secondary) {
    entries.push({ kid: 2, secret: secondary });
  }
  return KeyRing.fromEntries(signingKid, entries);
}
