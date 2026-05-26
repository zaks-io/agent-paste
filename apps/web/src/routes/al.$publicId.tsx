import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { cn } from "../lib/cn";
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

  useEffect(() => {
    const blob = window.location.hash.replace(/^#/, "");
    if (!blob) {
      setState({ kind: "not_found" });
      return;
    }
    fetch("/al-resolve", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ public_id: publicId, blob }),
    })
      .then(async (res) => {
        if (!res.ok) {
          setState({ kind: "not_found" });
          return;
        }
        const body = (await res.json()) as unknown;
        if (!isResolveBody(body)) {
          setState({ kind: "not_found" });
          return;
        }
        const resolved: ResolveResult = {
          kind: "resolved",
          render_mode: body.render_mode,
          ...(body.iframe_src ? { iframe_src: body.iframe_src } : {}),
          ...(body.title ? { title: body.title } : {}),
        };
        setState(resolved);
      })
      .catch(() => setState({ kind: "not_found" }));
  }, [publicId]);

  if (state.kind === "loading") {
    return (
      <main className="min-h-screen grid place-items-center">
        <p className="text-[14px] text-[hsl(var(--muted))]">Resolving…</p>
      </main>
    );
  }

  if (state.kind === "not_found") {
    return (
      <main className="min-h-screen grid place-items-center px-6">
        <div className="text-center grid gap-2 max-w-prose">
          <p className="text-[11px] uppercase tracking-[0.04em] text-[hsl(var(--muted))]">Access link</p>
          <h1 className="text-[32px] font-semibold tracking-[-0.02em]">Not found.</h1>
          <p className="text-[14px] text-[hsl(var(--muted))]">
            This link is invalid, expired, locked, or the secret in the URL is wrong.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between border-b border-[hsl(var(--rule))] px-6 h-[52px]">
        <h1 className="text-[14px] font-semibold">{state.title ?? "Shared artifact"}</h1>
        <span className="text-[11px] uppercase tracking-[0.04em] text-[hsl(var(--muted))]">{state.render_mode}</span>
      </header>
      <div className="flex-1 grid">
        {state.iframe_src ? (
          <iframe
            title="Artifact content"
            src={state.iframe_src}
            sandbox="allow-scripts allow-popups"
            referrerPolicy="no-referrer"
            className={cn("w-full h-full border-0")}
          />
        ) : (
          <p className="m-auto text-[14px] text-[hsl(var(--muted))]">No preview available.</p>
        )}
      </div>
    </main>
  );
}
