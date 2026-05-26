import { KeyRing } from "./key-ring.js";
import { parseKidLabel } from "./kid.js";

/** API-key pepper ring; wraps {@link KeyRing} with pepper-specific env parsing. */
export class PepperRing {
  private readonly ring: KeyRing;

  private constructor(ring: KeyRing) {
    this.ring = ring;
  }

  static single(pepper: string, kid = 1): PepperRing {
    return new PepperRing(KeyRing.single(pepper, kid));
  }

  static fromKeyRing(ring: KeyRing): PepperRing {
    return new PepperRing(ring);
  }

  static fromEnv(env: {
    API_KEY_PEPPER_V1?: string;
    API_KEY_PEPPER_V2?: string;
    API_KEY_PEPPER_CURRENT_KID?: string;
  }): PepperRing {
    const primary = env.API_KEY_PEPPER_V1;
    if (!primary) {
      throw new Error("pepper_ring_missing_env:API_KEY_PEPPER_V1");
    }
    const signingKid = parseKidLabel(env.API_KEY_PEPPER_CURRENT_KID, 1);
    const entries = [{ kid: 1, secret: primary }];
    if (env.API_KEY_PEPPER_V2) {
      entries.push({ kid: 2, secret: env.API_KEY_PEPPER_V2 });
    }
    return new PepperRing(KeyRing.fromEntries(signingKid, entries));
  }

  get currentKid(): number {
    return this.ring.signingKid;
  }

  get verifyKids(): readonly number[] {
    return this.ring.verifyKids;
  }

  pepperForKid(kid: number): string | undefined {
    return this.ring.secretForKid(kid);
  }

  currentPepper(): string {
    return this.ring.signingSecret();
  }

  stageVerifyPepper(kid: number, pepper: string): void {
    this.ring.stageVerifyKey(kid, pepper);
  }

  promoteSigningPepper(kid: number): void {
    this.ring.promoteSigningKid(kid);
  }

  dropPepper(kid: number): void {
    this.ring.dropKid(kid);
  }

  /** Underlying ring for signing-key-style tests and admin-token overlap verify. */
  asKeyRing(): KeyRing {
    return this.ring;
  }
}
