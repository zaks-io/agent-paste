import { isViewerFrameHeightMessage } from "@agent-paste/contracts";
import { cn } from "@agent-paste/ui";
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Sandboxed content-origin iframe shared by member and access-link viewers.
 * Tall artifacts report document height to the app shell via postMessage (injected
 * by the content worker for viewer-framed HTML); the host scroll container scrolls
 * the full-sized iframe instead of clipping inside a viewport-pinned box.
 */
export function ArtifactViewerIframe({ src, className }: { src: string; className?: string | undefined }) {
  return <ArtifactViewerIframeFrame key={src} src={src} className={className} />;
}

function ArtifactViewerIframeFrame({ src, className }: { src: string; className?: string | undefined }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const contentOrigin = useMemo(() => {
    try {
      return new URL(src).origin;
    } catch {
      return null;
    }
  }, [src]);

  useEffect(() => {
    if (!contentOrigin) {
      return;
    }
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) {
        return;
      }
      // Sandboxed without allow-same-origin, embedded documents have an opaque
      // origin and postMessage reports origin "null" — source identity is the
      // security boundary, not the serialized origin string.
      if (event.origin !== "null" && event.origin !== contentOrigin) {
        return;
      }
      if (!isViewerFrameHeightMessage(event.data)) {
        return;
      }
      const nextHeight = Math.ceil(event.data.height);
      setContentHeight(nextHeight);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [contentOrigin]);

  return (
    <iframe
      ref={iframeRef}
      title="Artifact content"
      src={src}
      sandbox="allow-scripts allow-popups"
      referrerPolicy="no-referrer"
      className={cn("block w-full border-0", className)}
      style={{
        height: contentHeight === null ? "100%" : `${contentHeight}px`,
        minHeight: contentHeight === null ? undefined : `${contentHeight}px`,
      }}
    />
  );
}
