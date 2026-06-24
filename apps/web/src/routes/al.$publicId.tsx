import type { LiveUpdatePointer } from "@agent-paste/contracts";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AccessLinkBrandBar } from "../components/access-links/AccessLinkBrandBar";
import { ArtifactViewerIframe } from "../components/artifacts/ArtifactViewerIframe";
import { connectLiveUpdates } from "../lib/live-updates";
import { publicPageMeta } from "../lib/page-meta";

type ResolveResult =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "resolved"; render_mode: string; iframe_src?: string; title?: string };

type ResolveBody = { render_mode: string; iframe_src?: string; title?: string };

function isResolveBody(value: unknown): value is ResolveBody {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.render_mode !== "string") return false;
  if (v.iframe_src !== undefined && typeof v.iframe_src !== "string") return false;
  if (v.title !== undefined && typeof v.title !== "string") return false;
  return true;
}

/**
 * Reads and validates the resolve response into the next viewer state. Returns
 * `null` when the request was aborted mid-flight so the caller skips the update.
 */
async function resolveViewerState(res: Response, signal: AbortSignal): Promise<ResolveResult | null> {
  if (signal.aborted) return null;
  if (!res.ok) return { kind: "not_found" };
  const body = (await res.json()) as unknown;
  if (signal.aborted) return null;
  if (!isResolveBody(body)) return { kind: "not_found" };
  return {
    kind: "resolved",
    render_mode: body.render_mode,
    ...(body.iframe_src ? { iframe_src: body.iframe_src } : {}),
    ...(body.title ? { title: body.title } : {}),
  };
}

export const Route = createFileRoute("/al/$publicId")({
  component: AccessLinkViewer,
  head: ({ params, matches }) => ({
    meta: [
      { name: "referrer", content: "no-referrer" },
      ...publicPageMeta({
        title: "Access Link",
        description: "View a shared artifact via an agent-paste access link.",
        path: `/al/${params.publicId}`,
        social: true,
        noIndex: true,
        ogType: "website",
        matches,
      }).meta,
    ],
  }),
});

function AccessLinkViewer() {
  const { publicId } = Route.useParams();
  const [state, setState] = useState<ResolveResult>({ kind: "loading" });
  const liveBlobRef = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const blob = window.location.hash.replace(/^#/, "");
    liveBlobRef.current = blob || null;
    if (!blob) {
      setState({ kind: "not_found" });
      return () => controller.abort();
    }
    setState({ kind: "loading" });
    fetch("/api/access-links/resolve", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        public_id: publicId,
        blob,
      }),
      signal: controller.signal,
    })
      .then(async (res) => {
        const next = await resolveViewerState(res, controller.signal);
        if (next) {
          setState(next);
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        if (!controller.signal.aborted) {
          setState({ kind: "not_found" });
        }
      });
    return () => controller.abort();
  }, [publicId]);

  const liveUpdatesEnabled = state.kind === "resolved";

  useLayoutEffect(() => {
    if (!liveUpdatesEnabled) {
      return;
    }
    const blob = liveBlobRef.current;
    if (!blob) {
      return;
    }
    const connection = connectLiveUpdates({
      url: `/api/live/access-links/${publicId}`,
      method: "POST",
      body: JSON.stringify({ blob }),
      onPointer: (pointer: LiveUpdatePointer) => {
        setState((current) =>
          current.kind === "resolved"
            ? {
                ...current,
                iframe_src: pointer.iframe_src,
                render_mode: pointer.render_mode,
                title: pointer.title,
              }
            : current,
        );
      },
      onRevoked: () => {
        setState({ kind: "not_found" });
      },
    });
    return () => connection.close();
  }, [publicId, liveUpdatesEnabled]);

  if (state.kind === "loading") {
    return (
      <main className="min-h-screen grid place-items-center">
        <p className="text-base text-muted">Resolving…</p>
      </main>
    );
  }

  if (state.kind === "not_found") {
    return (
      <main className="min-h-screen grid place-items-center px-6">
        <div className="text-center grid gap-2 max-w-prose">
          <p className="text-mono-sm uppercase tracking-wide text-muted">Access link</p>
          <h1 className="text-h1 font-semibold tracking-tighter">Not found.</h1>
          <p className="text-base text-muted">
            This link is invalid, expired, locked, or the secret in the URL is wrong.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="h-screen w-screen overflow-y-auto bg-background">
      <div className="min-h-full">
        {state.iframe_src ? (
          <ArtifactViewerIframe src={state.iframe_src} className="min-h-screen" />
        ) : (
          <p className="m-auto text-base text-muted">No preview available.</p>
        )}
      </div>
      <AccessLinkBrandBar publicId={publicId} renderMode={state.render_mode} title={state.title} />
    </main>
  );
}
