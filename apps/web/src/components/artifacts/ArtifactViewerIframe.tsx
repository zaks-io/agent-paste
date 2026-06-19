import { cn } from "@agent-paste/ui";

/**
 * Sandboxed content-origin iframe shared by member and access-link viewers.
 * `overflow-auto` overrides the UA default `overflow: clip` on iframe elements so
 * tall published artifacts scroll inside the viewport-pinned frame.
 */
export function ArtifactViewerIframe({ src, className }: { src: string; className?: string }) {
  return (
    <iframe
      title="Artifact content"
      src={src}
      sandbox="allow-scripts allow-popups"
      referrerPolicy="no-referrer"
      className={cn("h-full w-full border-0 overflow-auto", className)}
    />
  );
}
