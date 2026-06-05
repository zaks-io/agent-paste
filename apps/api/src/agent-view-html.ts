import { getRequestId, REQUEST_ID_HEADER } from "@agent-paste/auth";
import { BASELINE_SECURITY_HEADERS } from "@agent-paste/worker-runtime";
import type { AppContext } from "./env.js";

export function wantsHtml(request: Request): boolean {
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("text/html") && !accept.includes("application/json");
}

export function htmlAgentViewResponse(context: AppContext, view: unknown): Response {
  const data = view as {
    artifact_id?: string;
    revision_id?: string;
    title?: string;
    view_url?: string;
    ephemeral_tier?: boolean;
    files?: Array<{ path?: string; url?: string; content_type?: string; size_bytes?: number }>;
  };
  const noindex = data.ephemeral_tier === true;
  const files = Array.isArray(data.files) ? data.files : [];
  const body = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    ${noindex ? '<meta name="robots" content="noindex,nofollow">' : ""}
    <title>${escapeHtml(data.title ?? "Agent View")}</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 2rem; line-height: 1.5; color: #111827; }
      code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      pre { background: #f3f4f6; border: 1px solid #e5e7eb; padding: 1rem; overflow: auto; }
      a { color: #064e3b; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(data.title ?? "Agent View")}</h1>
    <p><strong>Artifact:</strong> <code>${escapeHtml(data.artifact_id ?? "")}</code></p>
    <p><strong>Revision:</strong> <code>${escapeHtml(data.revision_id ?? "")}</code></p>
    ${data.view_url ? `<p><a href="${escapeAttribute(data.view_url)}">Open entrypoint</a></p>` : ""}
    <h2>Files</h2>
    <ul>
      ${files
        .map(
          (file) =>
            `<li><a href="${escapeAttribute(file.url ?? "#")}">${escapeHtml(file.path ?? "")}</a> <code>${escapeHtml(
              file.content_type ?? "",
            )}</code> ${typeof file.size_bytes === "number" ? `${file.size_bytes} bytes` : ""}</li>`,
        )
        .join("")}
    </ul>
    <h2>JSON</h2>
    <pre>${escapeHtml(JSON.stringify(view, null, 2))}</pre>
  </body>
</html>`;

  // Start from the baseline, then override (Headers is case-insensitive, so the
  // stricter referrer-policy and the tailored CSP replace the baseline values).
  const headers = new Headers(BASELINE_SECURITY_HEADERS);
  headers.set("cache-control", "no-store");
  headers.set(
    "content-security-policy",
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
  );
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  headers.set(REQUEST_ID_HEADER, getRequestId(context));
  if (noindex) {
    headers.set("x-robots-tag", "noindex, nofollow");
  }
  return new Response(body, { headers });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("`", "&#96;");
}
