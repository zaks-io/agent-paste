export type ArtifactBytesKeyRing = {
  secretForKid(kid: number): string | undefined;
};

export const ARTIFACT_BYTES_DERIVATION_INFO = "agent-paste/artifact-bytes/v1";
export const ARTIFACT_BYTES_ENCRYPTION_ALG = "aes-256-gcm";
export const ARTIFACT_BYTES_AAD_VERSION = "v1";
export const ARTIFACT_BYTES_GCM_IV_BYTES = 12;
export const ARTIFACT_BYTES_GCM_TAG_BYTES = 16;
export const ARTIFACT_BYTES_ENCRYPTION_OVERHEAD_BYTES = ARTIFACT_BYTES_GCM_IV_BYTES + ARTIFACT_BYTES_GCM_TAG_BYTES;

export const ARTIFACT_BYTES_METADATA_KEYS = {
  kid: "enc_kid",
  alg: "enc_alg",
  aadVersion: "enc_aad_v",
} as const;

export type ArtifactBytesAadContext = {
  workspaceId: string;
  artifactId: string;
  revisionId: string;
  normalizedPath: string;
};

export type ArtifactBytesEncryptionMetadata = {
  enc_kid: string;
  enc_alg: typeof ARTIFACT_BYTES_ENCRYPTION_ALG;
  enc_aad_v: typeof ARTIFACT_BYTES_AAD_VERSION;
};

export type EncryptedArtifactObject = {
  ciphertext: Uint8Array;
  customMetadata: ArtifactBytesEncryptionMetadata;
};

export type RevisionFileObjectKeyParts = {
  artifactId: string;
  revisionId: string;
  path: string;
};

const revisionFileKeyPattern = /^artifacts\/([^/]+)\/revisions\/([^/]+)\/files\/(.+)$/u;
const kidPattern = /^[1-9]\d*$/u;

export function ciphertextByteLengthForPlaintext(plaintextBytes: number): number {
  return ARTIFACT_BYTES_ENCRYPTION_OVERHEAD_BYTES + plaintextBytes;
}

export function plaintextByteLengthFromStoredObject(storedBytes: number): number {
  if (storedBytes < ARTIFACT_BYTES_ENCRYPTION_OVERHEAD_BYTES) {
    throw new Error("artifact_bytes_ciphertext_too_short");
  }
  return storedBytes - ARTIFACT_BYTES_ENCRYPTION_OVERHEAD_BYTES;
}

export function isArtifactBytesEncryptionMetadata(
  metadata: Record<string, string> | undefined,
): metadata is ArtifactBytesEncryptionMetadata {
  const kid = metadata?.[ARTIFACT_BYTES_METADATA_KEYS.kid];
  return (
    metadata?.[ARTIFACT_BYTES_METADATA_KEYS.alg] === ARTIFACT_BYTES_ENCRYPTION_ALG &&
    metadata?.[ARTIFACT_BYTES_METADATA_KEYS.aadVersion] === ARTIFACT_BYTES_AAD_VERSION &&
    typeof kid === "string" &&
    kid.length > 0
  );
}

export function parseRevisionFileObjectKey(key: string): RevisionFileObjectKeyParts | null {
  const match = revisionFileKeyPattern.exec(key);
  if (!match) {
    return null;
  }
  const [, artifactId, revisionId, path] = match;
  if (!artifactId || !revisionId || !path) {
    return null;
  }
  return { artifactId, revisionId, path };
}

function parseArtifactBytesKid(value: string): number {
  if (!kidPattern.test(value)) {
    throw new Error("artifact_bytes_invalid_kid");
  }
  const kid = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(kid)) {
    throw new Error("artifact_bytes_invalid_kid");
  }
  return kid;
}

function asBufferSource(bytes: Uint8Array): BufferSource {
  if (bytes.buffer instanceof ArrayBuffer) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  return Uint8Array.from(bytes);
}

export function composeArtifactBytesAad(context: ArtifactBytesAadContext): Uint8Array {
  const payload = [
    ARTIFACT_BYTES_AAD_VERSION,
    context.workspaceId,
    context.artifactId,
    context.revisionId,
    context.normalizedPath,
  ].join("|");
  return new TextEncoder().encode(payload);
}

export function encryptionMetadataForKid(kid: number): ArtifactBytesEncryptionMetadata {
  return {
    [ARTIFACT_BYTES_METADATA_KEYS.kid]: String(kid),
    [ARTIFACT_BYTES_METADATA_KEYS.alg]: ARTIFACT_BYTES_ENCRYPTION_ALG,
    [ARTIFACT_BYTES_METADATA_KEYS.aadVersion]: ARTIFACT_BYTES_AAD_VERSION,
  };
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", asBufferSource(bytes)));
}

async function importRootHkdfKey(secret: string): Promise<CryptoKey> {
  const material = await sha256(new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", asBufferSource(material), "HKDF", false, ["deriveKey"]);
}

async function deriveWorkspaceDek(rootSecret: string, workspaceId: string): Promise<CryptoKey> {
  const rootKey = await importRootHkdfKey(rootSecret);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode(workspaceId),
      info: new TextEncoder().encode(ARTIFACT_BYTES_DERIVATION_INFO),
    },
    rootKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptArtifactBytes(input: {
  plaintext: Uint8Array;
  rootSecret: string;
  kid: number;
  context: ArtifactBytesAadContext;
}): Promise<EncryptedArtifactObject> {
  const dek = await deriveWorkspaceDek(input.rootSecret, input.context.workspaceId);
  const iv = crypto.getRandomValues(new Uint8Array(ARTIFACT_BYTES_GCM_IV_BYTES));
  const additionalData = composeArtifactBytesAad(input.context);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: asBufferSource(iv), additionalData: asBufferSource(additionalData) },
      dek,
      asBufferSource(input.plaintext),
    ),
  );
  const ciphertext = new Uint8Array(iv.byteLength + encrypted.byteLength);
  ciphertext.set(iv, 0);
  ciphertext.set(encrypted, iv.byteLength);
  return {
    ciphertext,
    customMetadata: encryptionMetadataForKid(input.kid),
  };
}

export async function decryptArtifactBytes(input: {
  ciphertext: Uint8Array;
  rootSecret: string;
  metadata: ArtifactBytesEncryptionMetadata;
  context: ArtifactBytesAadContext;
}): Promise<Uint8Array> {
  if (input.ciphertext.byteLength < ARTIFACT_BYTES_ENCRYPTION_OVERHEAD_BYTES) {
    throw new Error("artifact_bytes_ciphertext_too_short");
  }
  parseArtifactBytesKid(input.metadata.enc_kid);
  const dek = await deriveWorkspaceDek(input.rootSecret, input.context.workspaceId);
  const iv = input.ciphertext.subarray(0, ARTIFACT_BYTES_GCM_IV_BYTES);
  const encrypted = input.ciphertext.subarray(ARTIFACT_BYTES_GCM_IV_BYTES);
  const additionalData = composeArtifactBytesAad(input.context);
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: asBufferSource(iv), additionalData: asBufferSource(additionalData) },
      dek,
      asBufferSource(encrypted),
    ),
  );
}

export async function decryptArtifactBytesWithKeyRing(input: {
  ciphertext: Uint8Array;
  ring: ArtifactBytesKeyRing;
  metadata: ArtifactBytesEncryptionMetadata;
  context: ArtifactBytesAadContext;
}): Promise<Uint8Array> {
  const kid = parseArtifactBytesKid(input.metadata.enc_kid);
  const rootSecret = input.ring.secretForKid(kid);
  if (!rootSecret) {
    throw new Error("artifact_bytes_unknown_kid");
  }
  return decryptArtifactBytes({
    ciphertext: input.ciphertext,
    rootSecret,
    metadata: input.metadata,
    context: input.context,
  });
}

export async function bytesFromReadableBody(
  body: ReadableStream | ArrayBuffer | string | null | undefined,
): Promise<Uint8Array> {
  if (body === null || body === undefined) {
    return new Uint8Array();
  }
  if (typeof body === "string") {
    return new TextEncoder().encode(body);
  }
  if (body instanceof ArrayBuffer) {
    return new Uint8Array(body);
  }
  if (body instanceof Uint8Array) {
    return body;
  }
  return new Uint8Array(await new Response(body).arrayBuffer());
}

export class ReadableBodyTooLargeError extends Error {
  constructor() {
    super("readable_body_exceeds_limit");
    this.name = "ReadableBodyTooLargeError";
  }
}

/**
 * Reads a request stream while refusing to buffer more than `maxBytes`. The cap
 * is enforced as chunks arrive so a body that lies about its `content-length`
 * cannot exhaust memory before any size check runs. Throws
 * {@link ReadableBodyTooLargeError} the moment the cumulative length exceeds the
 * cap; the stream is cancelled rather than drained.
 */
export async function bytesFromReadableBodyCapped(
  body: ReadableStream<Uint8Array> | null | undefined,
  maxBytes: number,
): Promise<Uint8Array> {
  if (body === null || body === undefined) {
    return new Uint8Array();
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ReadableBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
