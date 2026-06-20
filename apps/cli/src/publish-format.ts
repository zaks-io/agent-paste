import { formatBytes, hyperlink, type OutputMode, paint } from "./render.js";

export type PublishResultShape = {
  artifact_id: string;
  revision_id: string;
  title: string;
  private_url?: string | undefined;
  revision_content_url: string;
  agent_view_url: string;
  expires_at: string;
  // Present only on ephemeral publish: the no-login (script-disabled) Share Link
  // the server auto-creates so the agent hands back a URL that works at once.
  unlisted_url?: string | undefined;
  upload_stats?: {
    total_files: number;
    total_bytes: number;
    uploaded_files: number;
    uploaded_bytes: number;
    reused_files: number;
    reused_bytes: number;
  };
};

// Render expires_at as a plain calendar date when it parses as an ISO instant;
// otherwise pass the raw value through unchanged. Never fabricate a date.
export function formatExpiry(expiresAt: string): string {
  const date = new Date(expiresAt);
  return Number.isNaN(date.getTime()) ? expiresAt : date.toISOString().slice(0, 10);
}

function uploadStatsLine(mode: OutputMode, stats: NonNullable<PublishResultShape["upload_stats"]>): string {
  const uploaded = paint(mode, "green", `${stats.uploaded_files}/${stats.total_files} uploaded`);
  return `  ${paint(mode, "dim", "Upload")}    ${uploaded}, ${stats.reused_files} reused · ${formatBytes(stats.uploaded_bytes)} sent, ${formatBytes(stats.reused_bytes)} cached`;
}

// Human-readable publish result. The handoff leads with the live viewer URL,
// then shows the one command to revise this Artifact in place so the agent
// edits via add-revision (stable link, live-updates the open page) instead of
// republishing a new Artifact. Snapshot URLs stay on the JSON surface.
export function formatPublishResult(mode: OutputMode, result: PublishResultShape, updateCommand: string): string {
  const label = (text: string) => paint(mode, "dim", text);
  const privateUrl = result.private_url;
  if (!privateUrl) {
    throw new Error("Authenticated publish result must include private_url");
  }
  return [
    `${paint(mode, "green", "✓")} Published ${paint(mode, "bold", `"${result.title}"`)}`,
    "",
    `  ${label("View")}      ${hyperlink(mode, privateUrl)}`,
    `  ${label("Expires")}   ${formatExpiry(result.expires_at)}`,
    ...(result.upload_stats ? [uploadStatsLine(mode, result.upload_stats)] : []),
    "",
    `  ${label("Update")}    ${updateCommand}`,
    `            ${label("(revises this Artifact; same link live-updates the open page)")}`,
    ...(privateUrl ? ["", paint(mode, "cyan", `  → open ${privateUrl}`)] : []),
  ].join("\n");
}

export function ephemeralClaimUrl(claimToken: string): string {
  const base = (process.env.AGENT_PASTE_WEB_URL ?? "https://app.agent-paste.sh").replace(/\/+$/, "");
  return `${base}/claim#${claimToken}`;
}

export function formatEphemeralPublishResult(mode: OutputMode, result: PublishResultShape, claimUrl: string): string {
  assertClaimTokenNotInPublicUrls(result, claimUrl);
  const label = (text: string) => paint(mode, "dim", text);
  const sharedUrl = result.unlisted_url;
  return [
    `${paint(mode, "green", "✓")} Published ${paint(mode, "bold", `"${result.title}"`)}`,
    "",
    ...(sharedUrl
      ? [
          paint(mode, "dim", "Hand this link to anyone. No login, static page, expires soon:"),
          `  ${label("Link")}     ${hyperlink(mode, sharedUrl)}`,
        ]
      : []),
    `  ${label("Expires")}   ${formatExpiry(result.expires_at)}`,
    ...(result.upload_stats ? [uploadStatsLine(mode, result.upload_stats)] : []),
    "",
    paint(mode, "dim", "Log in and open this to keep it, make it interactive, and own it:"),
    `  ${label("Claim")}    ${hyperlink(mode, claimUrl)}`,
    paint(mode, "dim", "The token lives in the URL hash only (never the query string)."),
    "",
    paint(mode, "cyan", `  → open ${sharedUrl ?? claimUrl}`),
  ].join("\n");
}

function assertClaimTokenNotInPublicUrls(result: PublishResultShape, claimUrl: string): void {
  const claimToken = claimUrl.split("#")[1] ?? "";
  if (!claimToken || !claimUrl.includes("#")) {
    throw new Error("Claim URL must carry the token in the URL hash");
  }
  // The token legitimately lives in the hash, so checking the whole URL for it always
  // matches. Scope the leak check to the query string (the part between ? and #).
  const query = claimUrl.split("#")[0]?.split("?")[1] ?? "";
  if (query.includes(claimToken)) {
    throw new Error("Claim Token must not appear in the URL query string");
  }
  if (
    (result.private_url?.includes(claimToken) ?? false) ||
    result.revision_content_url.includes(claimToken) ||
    result.agent_view_url.includes(claimToken) ||
    (result.unlisted_url?.includes(claimToken) ?? false)
  ) {
    throw new Error("Claim Token must not appear in public Access Link Signed URLs");
  }
}

// An edit whose result reproduces the stored bytes mints no Revision. Report the
// no-op plainly and echo the stable link so the agent still has it to hand back —
// the live page already shows this content.
export function formatEditNoop(mode: OutputMode, payload: { title: string; private_url: string }): string {
  const label = (text: string) => paint(mode, "dim", text);
  return [
    `${paint(mode, "dim", "•")} No change to ${paint(mode, "bold", `"${payload.title}"`)} (edits reproduce the stored content)`,
    "",
    `  ${label("View")}      ${hyperlink(mode, payload.private_url)}`,
  ].join("\n");
}

export type SetVisibilityResultShape =
  | { visibility: "private"; private_url: string; revoked_access_link_ids: readonly string[] }
  | { visibility: "unlisted"; unlisted_url: string; access_link_id: string };

export function formatSetVisibility(mode: OutputMode, payload: SetVisibilityResultShape): string {
  const label = (text: string) => paint(mode, "dim", text);
  if (payload.visibility === "private") {
    const count = payload.revoked_access_link_ids.length;
    return [
      `${paint(mode, "green", "✓")} Visibility set to private`,
      "",
      `  ${label("View")}      ${hyperlink(mode, payload.private_url)}`,
      `  ${label("Revoked")}   ${count} active Access Link${count === 1 ? "" : "s"}`,
      "",
      paint(mode, "cyan", `  → open ${payload.private_url}`),
    ].join("\n");
  }

  return [
    `${paint(mode, "green", "✓")} Visibility set to unlisted`,
    "",
    `  ${label("Unlisted")}  ${hyperlink(mode, payload.unlisted_url)}`,
    `            ${label("(anyone with this link can open it, no login; revoke to take it down)")}`,
    "",
    paint(mode, "cyan", `  → open ${payload.unlisted_url}`),
  ].join("\n");
}
