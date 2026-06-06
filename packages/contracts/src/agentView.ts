import { BundleAvailability } from "./bundle.js";
import {
  ArtifactId,
  FilePath,
  IsoDateTime,
  PlainTextDescription,
  PlainTextTitle,
  RevisionId,
  UrlString,
} from "./primitives.js";
import { z } from "./zod.js";

export const DisplayMetadata = z.object({
  title: PlainTextTitle,
  description: PlainTextDescription.nullable(),
});
export type DisplayMetadata = z.infer<typeof DisplayMetadata>;

const LockdownMetadata = z
  .object({
    locked: z.boolean(),
    locked_at: IsoDateTime.nullable(),
  })
  .strict();

export const AgentViewLockdownState = z
  .object({
    access_link: LockdownMetadata,
    platform: z
      .object({
        workspace: LockdownMetadata,
        artifact: LockdownMetadata,
      })
      .strict(),
  })
  .strict();
export type AgentViewLockdownState = z.infer<typeof AgentViewLockdownState>;

export const AgentViewFile = z.object({
  path: FilePath,
  size_bytes: z.number().int().nonnegative(),
  content_type: z.string().min(1).max(200),
  url: UrlString,
});
export type AgentViewFile = z.infer<typeof AgentViewFile>;

export const SafetyWarning = z
  .object({
    code: z.string().regex(/^[a-z0-9_]+$/),
    severity: z.enum(["info", "warning"]),
    scope: z.enum(["artifact", "revision", "file"]),
    file_path: FilePath.optional(),
    message: z.string().min(1).max(500),
    detected_at: IsoDateTime,
  })
  .superRefine((warning, ctx) => {
    if (warning.scope === "file" && warning.file_path === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["file_path"],
        message: "file_path is required when scope is 'file'",
      });
    }
    if (warning.scope !== "file" && warning.file_path !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["file_path"],
        message: "file_path must be omitted unless scope is 'file'",
      });
    }
  });
export type SafetyWarning = z.infer<typeof SafetyWarning>;

const AgentViewBase = z.object({
  artifact_id: ArtifactId,
  revision_id: RevisionId,
  title: PlainTextTitle,
  description: PlainTextDescription.nullable().optional(),
  created_at: IsoDateTime,
  expires_at: IsoDateTime,
  entrypoint: FilePath,
  view_url: UrlString,
  files: z.array(AgentViewFile).min(1).max(100),
  safety_warnings: z.array(SafetyWarning).max(100).default([]),
  bundle: BundleAvailability,
});

export const PublicAgentView = AgentViewBase;
export type PublicAgentView = z.infer<typeof PublicAgentView>;

export const AgentView = AgentViewBase.extend({
  lockdown: AgentViewLockdownState.optional(),
});
export type AgentView = z.infer<typeof AgentView>;
