import type { RenderMode } from "./revisions.js";

// Single source of truth for entrypoint-extension → Render Mode inference.
// The CLI (local inference/UX) and the server (publish-time storage) both read
// this map so the value a client predicts is the value the server stores.
const renderModesByExtension: ReadonlyMap<string, RenderMode> = new Map<string, RenderMode>([
  [".html", "html"],
  [".htm", "html"],
  [".md", "markdown"],
  [".markdown", "markdown"],
  [".txt", "text"],
  [".text", "text"],
  [".png", "image"],
  [".jpg", "image"],
  [".jpeg", "image"],
  [".gif", "image"],
  [".webp", "image"],
  [".svg", "image"],
  [".mp3", "audio"],
  [".wav", "audio"],
  [".m4a", "audio"],
  [".ogg", "audio"],
  [".mp4", "video"],
  [".webm", "video"],
  [".mov", "video"],
]);

export function inferRenderModeFromEntrypoint(entrypoint: string): RenderMode | undefined {
  const dot = entrypoint.lastIndexOf(".");
  if (dot < 0) {
    return undefined;
  }
  return renderModesByExtension.get(entrypoint.slice(dot).toLowerCase());
}
