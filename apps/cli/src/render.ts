import { AgentPasteError } from "@agent-paste/api-client";

// Rich = colour + spinner for a person at a TTY. Plain = same layout, ANSI
// stripped, no carriage-return repaints (safe to pipe/redirect). Json = the
// machine contract, nothing but the payload on stdout. We hand-roll ANSI rather
// than depend on chalk/ora so the published CLI keeps zero runtime deps.
export type OutputMode = "rich" | "plain" | "json";

export type RenderEnv = {
  isTTY?: boolean;
  NO_COLOR?: string | undefined;
  CI?: string | undefined;
  TERM?: string | undefined;
};

export type ModeInputs = {
  json: boolean;
  color?: boolean | undefined;
  env: RenderEnv;
};

export function resolveMode({ json, color, env }: ModeInputs): OutputMode {
  if (json) {
    return "json";
  }
  if (color === true) {
    return "rich";
  }
  if (color === false) {
    return "plain";
  }
  if (!env.isTTY || env.NO_COLOR !== undefined || env.CI !== undefined || env.TERM === "dumb") {
    return "plain";
  }
  return "rich";
}

const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
} as const;

type Style = keyof typeof ANSI;

export function paint(mode: OutputMode, style: Style, text: string): string {
  return mode === "rich" ? `${ANSI[style]}${text}${ANSI.reset}` : text;
}

// OSC 8 hyperlink: clickable in modern terminals, and the visible label is the
// raw URL so it stays copy-pasteable. Only emitted in rich mode; plain/json get
// the bare URL.
export function hyperlink(mode: OutputMode, url: string): string {
  if (mode !== "rich") {
    return url;
  }
  return `\x1b]8;;${url}\x1b\\${url}\x1b]8;;\x1b\\`;
}

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) {
    return `${Math.max(0, Math.round(bytes))} B`;
  }
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${UNITS[unit]}`;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

export type ProgressState = { done: number; total: number; bytes: number };

export type ProgressDeps = {
  write?: (chunk: string) => void;
};

// Per-file progress. update() repaints one in-place line in rich mode; in
// plain/json it is a no-op so a redirected log never sees carriage returns. The
// contract is granularity-agnostic: a serial upload loop ticks 1/6, 2/6…, and a
// future parallel loop calling update() on each completion behaves identically.
export function createProgress(mode: OutputMode, deps: ProgressDeps = {}) {
  const write = deps.write ?? ((chunk: string) => process.stderr.write(chunk));
  let frame = 0;
  let active = false;
  const render = (state: ProgressState) => {
    if (mode !== "rich") {
      return;
    }
    active = true;
    const spin = SPINNER_FRAMES[frame % SPINNER_FRAMES.length];
    frame += 1;
    write(
      `\r\x1b[K${ANSI.dim}${spin} Uploading  ${state.done}/${state.total} files · ${formatBytes(state.bytes)} sent${ANSI.reset}`,
    );
  };
  return {
    update(state: ProgressState) {
      render(state);
    },
    done() {
      if (mode === "rich" && active) {
        write("\r\x1b[K");
        active = false;
      }
    },
  };
}

export const EXIT_GENERIC = 1;
export const EXIT_AUTH = 2;
export const EXIT_QUOTA = 3;
export const EXIT_VALIDATION = 4;
export const EXIT_NOT_FOUND = 5;
export const EXIT_NETWORK = 6;

// Stable exit codes so scripts branch without parsing strings. We bucket by HTTP
// status, not error code: every contract ErrorCode maps to a status (see
// packages/contracts/src/mcp/error-codes.ts) and the api-client preserves it, so
// status is the durable signal and avoids pinning code names that drift.
// 429 (rate-limit + write-allowance) is EXIT_QUOTA so agents back off. Documented
// in docs/specs/cli.md — keep the two in sync.
export function exitCodeFor(error: unknown): number {
  if (!(error instanceof AgentPasteError)) {
    return EXIT_GENERIC;
  }
  if (error.status === 401 || error.status === 403) {
    return EXIT_AUTH;
  }
  if (error.status === 429) {
    return EXIT_QUOTA;
  }
  if (error.status === 404) {
    return EXIT_NOT_FOUND;
  }
  if (error.status === 422 || error.status === 400) {
    return EXIT_VALIDATION;
  }
  if (error.status >= 500) {
    return EXIT_NETWORK;
  }
  return EXIT_GENERIC;
}

export function formatError(mode: OutputMode, error: unknown): string {
  const asError = error instanceof Error ? error : new Error(String(error));
  const code = error instanceof AgentPasteError ? error.code : "cli_error";
  const docs = error instanceof AgentPasteError ? error.docs : undefined;
  if (mode === "json") {
    return `${JSON.stringify({ error: { code, message: asError.message, ...(docs ? { docs } : {}) } })}\n`;
  }
  const lines = [`${paint(mode, "red", "✗")} ${paint(mode, "bold", code)} — ${asError.message}`];
  if (docs) {
    lines.push(`  ${hyperlink(mode, docs)}`);
  }
  return `${lines.join("\n")}\n`;
}
