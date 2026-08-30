import { formatBytes, hyperlink, type OutputMode, paint } from "./render.js";

export type PublishResultShape = {
  artifact_id: string;
  revision_id: string;
  title: string;
  url: string;
  expires_at: string;
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

// Human-readable publish result. The capability URL is the Artifact itself and
// remains stable when the same Artifact is revised.
export function formatPublishResult(mode: OutputMode, result: PublishResultShape, updateCommand: string): string {
  const label = (text: string) => paint(mode, "dim", text);
  return [
    `${paint(mode, "green", "✓")} Published ${paint(mode, "bold", `"${result.title}"`)}`,
    "",
    `  ${label("View")}      ${hyperlink(mode, result.url)}`,
    `  ${label("Expires")}   ${formatExpiry(result.expires_at)}`,
    ...(result.upload_stats ? [uploadStatsLine(mode, result.upload_stats)] : []),
    "",
    `  ${label("Update")}    ${updateCommand}`,
    `            ${label("(revises this Artifact; the same link shows the latest revision)")}`,
    "",
    paint(mode, "cyan", `  → open ${result.url}`),
  ].join("\n");
}

export function ephemeralClaimUrl(claimToken: string): string {
  const base = (process.env.AGENT_PASTE_WEB_URL ?? "https://app.agent-paste.sh").replace(/\/+$/, "");
  return `${base}/claim#${claimToken}`;
}

export function formatEphemeralPublishResult(mode: OutputMode, result: PublishResultShape, claimUrl: string): string {
  assertClaimTokenNotInPublicUrls(result, claimUrl);
  const label = (text: string) => paint(mode, "dim", text);
  return [
    `${paint(mode, "green", "✓")} Published ${paint(mode, "bold", `"${result.title}"`)}`,
    "",
    paint(mode, "dim", "Hand this link to anyone. No login, expires soon:"),
    `  ${label("Link")}     ${hyperlink(mode, result.url)}`,
    `  ${label("Expires")}   ${formatExpiry(result.expires_at)}`,
    ...(result.upload_stats ? [uploadStatsLine(mode, result.upload_stats)] : []),
    "",
    paint(mode, "dim", "Log in and open this to keep and own it:"),
    `  ${label("Claim")}    ${hyperlink(mode, claimUrl)}`,
    paint(mode, "dim", "The token lives in the URL hash only (never the query string)."),
    "",
    paint(mode, "cyan", `  → open ${result.url}`),
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
  if (result.url.includes(claimToken)) {
    throw new Error("Claim Token must not appear in the Artifact URL");
  }
}

// An edit whose result reproduces the stored bytes mints no Revision. Report the
// no-op plainly and echo the stable link so the agent still has it to hand back —
// the live page already shows this content.
export function formatEditNoop(mode: OutputMode, payload: { title: string; url: string }): string {
  const label = (text: string) => paint(mode, "dim", text);
  return [
    `${paint(mode, "dim", "•")} No change to ${paint(mode, "bold", `"${payload.title}"`)} (edits reproduce the stored content)`,
    "",
    `  ${label("View")}      ${hyperlink(mode, payload.url)}`,
  ].join("\n");
}
