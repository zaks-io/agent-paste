import { createHash, randomBytes } from "node:crypto";

export type Pkce = {
  verifier: string;
  challenge: string;
  state: string;
};

// RFC 7636 caps the verifier at 43-128 chars; 32 random bytes base64url-encode
// to 43 chars, the minimum that still carries full entropy.
const VERIFIER_BYTES = 32;
const STATE_BYTES = 16;

export function createPkce(): Pkce {
  const verifier = base64Url(randomBytes(VERIFIER_BYTES));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  const state = base64Url(randomBytes(STATE_BYTES));
  return { verifier, challenge, state };
}

export function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
