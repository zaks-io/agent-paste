import { z } from "./zod.js";

const ulidBody = "[0-9A-HJKMNP-TV-Z]{26}";

export const CLAIM_CODE_HEADER = "X-Agent-Paste-Claim-Code";

const prefixedId = <Brand extends string>(prefix: string) =>
  z
    .string()
    .regex(new RegExp(`^${prefix}_${ulidBody}$`))
    .brand<Brand>();

export const WorkspaceId = z.string().uuid().brand<"WorkspaceId">();
export type WorkspaceId = z.infer<typeof WorkspaceId>;

export const ArtifactId = prefixedId<"ArtifactId">("art");
export type ArtifactId = z.infer<typeof ArtifactId>;

export const RevisionId = prefixedId<"RevisionId">("rev");
export type RevisionId = z.infer<typeof RevisionId>;

export const UploadSessionId = prefixedId<"UploadSessionId">("upl");
export type UploadSessionId = z.infer<typeof UploadSessionId>;

export const ApiKeyId = prefixedId<"ApiKeyId">("key");
export type ApiKeyId = z.infer<typeof ApiKeyId>;

export const ClaimTokenId = prefixedId<"ClaimTokenId">("ct");
export type ClaimTokenId = z.infer<typeof ClaimTokenId>;

export const AccessLinkId = prefixedId<"AccessLinkId">("al");
export type AccessLinkId = z.infer<typeof AccessLinkId>;

export const OperationEventId = prefixedId<"OperationEventId">("evt");
export type OperationEventId = z.infer<typeof OperationEventId>;

export const ClaimCode = prefixedId<"ClaimCode">("clm");
export type ClaimCode = z.infer<typeof ClaimCode>;

export const OptionalClaimCodeInput = z.preprocess((value) => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return ClaimCode.safeParse(trimmed).success ? trimmed : undefined;
}, ClaimCode.optional());

export const IdempotencyKey = z
  .string()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/)
  .brand<"IdempotencyKey">();
export type IdempotencyKey = z.infer<typeof IdempotencyKey>;

export const Cursor = z.string().min(1).max(500).brand<"Cursor">();
export type Cursor = z.infer<typeof Cursor>;

export const IsoDateTime = z.string().datetime({ offset: true });
export type IsoDateTime = z.infer<typeof IsoDateTime>;

export const UrlString = z.string().url();
export type UrlString = z.infer<typeof UrlString>;

export const ApiKeyBearer = z
  .string()
  .regex(/^ap_pk_(preview|production|live)_[0-9A-HJKMNP-TV-Z]{16}_[A-Za-z0-9_-]{32,}$/)
  .brand<"ApiKeyBearer">();
export type ApiKeyBearer = z.infer<typeof ApiKeyBearer>;

export const ClaimTokenBearer = z
  .string()
  .regex(/^ap_ct_(preview|production)_[0-9A-HJKMNP-TV-Z]{16}(\.clm_[0-9A-HJKMNP-TV-Z]{26})?_[A-Za-z0-9_-]{32,}$/)
  .brand<"ClaimTokenBearer">();
export type ClaimTokenBearer = z.infer<typeof ClaimTokenBearer>;

export const FilePath = z
  .string()
  .min(1)
  .max(4096)
  .refine((path) => !path.startsWith("/"), "must be relative")
  .refine((path) => !path.includes("\\"), "must use forward slashes")
  .refine((path) => !path.split("/").some((part) => part === "" || part === "." || part === ".."), {
    message: "must not contain empty, current-directory, or traversal segments",
  })
  .refine(
    (path) =>
      Array.from(path).every((character) => {
        const codePoint = character.codePointAt(0);
        return codePoint !== undefined && codePoint > 0x1f && codePoint !== 0x7f;
      }),
    "must not contain control characters",
  )
  .brand<"FilePath">();
export type FilePath = z.infer<typeof FilePath>;

export const Sha256Hex = z.string().regex(/^[a-f0-9]{64}$/);
export type Sha256Hex = z.infer<typeof Sha256Hex>;

export const PlainTextTitle = z.string().trim().min(1).max(160);
export type PlainTextTitle = z.infer<typeof PlainTextTitle>;

export const PlainTextDescription = z.string().trim().max(2000);
export type PlainTextDescription = z.infer<typeof PlainTextDescription>;

export const PositiveInteger = z.number().int().positive();
export const NonNegativeInteger = z.number().int().nonnegative();
