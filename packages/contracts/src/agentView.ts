import { z } from "zod";
import {
  ArtifactId,
  FilePath,
  IsoDateTime,
  PlainTextDescription,
  PlainTextTitle,
  RevisionId,
  UrlString,
} from "./primitives.js";

export const DisplayMetadata = z.object({
  title: PlainTextTitle,
  description: PlainTextDescription.nullable(),
});
export type DisplayMetadata = z.infer<typeof DisplayMetadata>;

export const AgentViewFile = z.object({
  path: FilePath,
  size_bytes: z.number().int().nonnegative(),
  content_type: z.string().min(1).max(200),
  url: UrlString,
});
export type AgentViewFile = z.infer<typeof AgentViewFile>;

export const AgentView = z.object({
  artifact_id: ArtifactId,
  revision_id: RevisionId,
  title: PlainTextTitle,
  description: PlainTextDescription.nullable().optional(),
  created_at: IsoDateTime,
  expires_at: IsoDateTime,
  entrypoint: FilePath,
  view_url: UrlString,
  files: z.array(AgentViewFile).min(1).max(100),
});
export type AgentView = z.infer<typeof AgentView>;
