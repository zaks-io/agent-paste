import { base64UrlEncode, constantTimeEqual, hmac } from "./crypto.js";

/** Default hashcash difficulty (~200–400ms honest solve in Workers). */
export const DEFAULT_POW_DIFFICULTY_BITS = 20;

/** Challenge lifetime before a client must re-fetch. */
export const DEFAULT_POW_CHALLENGE_TTL_SECONDS = 5 * 60;

export type PowChallenge = {
  nonce: string;
  difficulty: number;
  expires_at: string;
  signature: string;
};

export type PowSolution = {
  nonce: string;
  counter: number;
};

export type IssuePowChallengeInput = {
  secret: string;
  difficulty?: number;
  ttlSeconds?: number;
  now?: Date;
};

export type VerifyPowSolutionInput = {
  secret: string;
  challenge: PowChallenge;
  solution: PowSolution;
  now?: Date;
};

export type PowNonceStore = {
  get(key: string): Promise<string | null | undefined>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

export async function issuePowChallenge(input: IssuePowChallengeInput): Promise<PowChallenge> {
  const now = input.now ?? new Date();
  const ttlSeconds = input.ttlSeconds ?? DEFAULT_POW_CHALLENGE_TTL_SECONDS;
  const difficulty = input.difficulty ?? DEFAULT_POW_DIFFICULTY_BITS;
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
  const nonce = base64UrlEncode(crypto.getRandomValues(new Uint8Array(24)));
  const signature = await signPowChallenge(input.secret, { nonce, difficulty, expires_at: expiresAt });
  return { nonce, difficulty, expires_at: expiresAt, signature };
}

export async function verifyPowSolution(input: VerifyPowSolutionInput): Promise<boolean> {
  const now = input.now ?? new Date();
  if (input.solution.nonce !== input.challenge.nonce) {
    return false;
  }
  if (Date.parse(input.challenge.expires_at) <= now.getTime()) {
    return false;
  }
  const expectedSignature = await signPowChallenge(input.secret, {
    nonce: input.challenge.nonce,
    difficulty: input.challenge.difficulty,
    expires_at: input.challenge.expires_at,
  });
  if (!constantTimeEqual(expectedSignature, input.challenge.signature)) {
    return false;
  }
  const digest = await sha256Digest(`${input.challenge.nonce}:${input.solution.counter}`);
  return countLeadingZeroBits(digest) >= input.challenge.difficulty;
}

export async function consumePowNonce(
  store: PowNonceStore,
  nonce: string,
  ttlSeconds: number,
): Promise<boolean> {
  // KV get-then-put is not atomic; concurrent replays of the same solved challenge could
  // both pass before either write lands. Blast radius is bounded by provision rate limits;
  // hashcash-over-KV accepts this window rather than a DO or compare-and-swap primitive.
  const key = powNonceKey(nonce);
  const existing = await store.get(key);
  if (existing !== null && existing !== undefined) {
    return false;
  }
  await store.put(key, "1", { expirationTtl: ttlSeconds });
  return true;
}

/** Brute-force a valid counter for tests and local tooling. */
export async function solvePowChallenge(challenge: PowChallenge): Promise<number> {
  let counter = 0;
  while (counter < Number.MAX_SAFE_INTEGER) {
    const digest = await sha256Digest(`${challenge.nonce}:${counter}`);
    if (countLeadingZeroBits(digest) >= challenge.difficulty) {
      return counter;
    }
    counter += 1;
  }
  throw new Error("pow_solution_not_found");
}

export function countLeadingZeroBits(digest: Uint8Array): number {
  let bits = 0;
  for (const byte of digest) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    let mask = 0x80;
    while ((byte & mask) === 0 && mask > 0) {
      bits += 1;
      mask >>= 1;
    }
    return bits;
  }
  return bits;
}

async function signPowChallenge(
  secret: string,
  fields: Pick<PowChallenge, "nonce" | "difficulty" | "expires_at">,
): Promise<string> {
  const payload = `${fields.nonce}|${fields.difficulty}|${fields.expires_at}`;
  return hmac(payload, secret);
}

async function sha256Digest(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return new Uint8Array(digest);
}

function powNonceKey(nonce: string): string {
  return `pow:spent:${nonce}`;
}
