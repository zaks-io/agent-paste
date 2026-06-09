import { EPHEMERAL_SAFETY_SCANNER_ID } from "@agent-paste/contracts";
import type { Env } from "../env.js";
import {
  createBuiltInSafetyScanner,
  type SafetyScanner,
  type SafetyScannerFile,
  type SafetyScannerWarning,
} from "./scanner.js";

const LLAMA_GUARD_MODEL = "@cf/meta/llama-guard-3-8b";
const MAX_GUARD_TEXT_CHARS = 12_000;

type AiBinding = NonNullable<Env["AI"]>;

export function isEphemeralScannerId(scannerId: string): boolean {
  return scannerId === EPHEMERAL_SAFETY_SCANNER_ID;
}

export function createEphemeralSafetyScanner(env: Env): SafetyScanner {
  const builtin = createBuiltInSafetyScanner();
  return {
    async scan(files) {
      const warnings = new Map<string, SafetyScannerWarning>();
      for (const warning of await builtin.scan(files)) {
        warnings.set(`${warning.code}:${warning.file_path ?? ""}`, warning);
      }
      for (const warning of scriptPresentWarnings(files)) {
        warnings.set(`${warning.code}:${warning.file_path ?? ""}`, warning);
      }
      for (const warning of await llamaGuardWarnings(env.AI, files)) {
        warnings.set(`${warning.code}:${warning.file_path ?? ""}`, warning);
      }
      return [...warnings.values()].sort((left, right) => {
        const filePath = (left.file_path ?? "").localeCompare(right.file_path ?? "");
        return filePath === 0 ? left.code.localeCompare(right.code) : filePath;
      });
    },
  };
}

function scriptPresentWarnings(files: readonly SafetyScannerFile[]): SafetyScannerWarning[] {
  const warnings: SafetyScannerWarning[] = [];
  for (const file of files) {
    const text = decodeText(file);
    if (text === null) {
      continue;
    }
    if (!isHtmlLike(file, text)) {
      continue;
    }
    if (!/<script\b/i.test(text) && !/\bon\w+\s*=/i.test(text)) {
      continue;
    }
    warnings.push({
      code: "script_present_unclaimed",
      severity: "info",
      scope: "file",
      file_path: file.path,
      message: "This revision contains script that stays dormant until the workspace is claimed.",
    });
  }
  return warnings;
}

async function llamaGuardWarnings(
  ai: AiBinding | undefined,
  files: readonly SafetyScannerFile[],
): Promise<SafetyScannerWarning[]> {
  if (!ai) {
    return [];
  }
  const chunks = files
    .map((file) => {
      const text = decodeText(file);
      return text === null ? null : { path: file.path, text };
    })
    .filter((chunk): chunk is { path: string; text: string } => chunk !== null);
  if (chunks.length === 0) {
    return [];
  }
  const combined = chunks
    .map((chunk) => `--- ${chunk.path} ---\n${chunk.text}`)
    .join("\n\n")
    .slice(0, MAX_GUARD_TEXT_CHARS);
  try {
    const result = await ai.run(LLAMA_GUARD_MODEL, {
      messages: [{ role: "user", content: combined }],
    });
    const verdict = parseLlamaGuardWorkersAiResult(result);
    if (!verdict || verdict.label !== "unsafe") {
      return [];
    }
    const categoryDetail = verdict.categories.length > 0 ? ` (${verdict.categories.join(", ")})` : "";
    return [
      {
        code: "llama_guard_unsafe",
        severity: "warning",
        scope: "revision",
        message: `Llama Guard flagged potentially unsafe content${categoryDetail}.`,
      },
    ];
  } catch {
    return [];
  }
}

export type LlamaGuardVerdict = { label: "safe" } | { label: "unsafe"; categories: readonly string[] };

const LLAMA_GUARD_CATEGORY_PATTERN = /\bS(?:1[0-4]|[1-9])\b/g;

/** Parses Workers AI `{ response: string }` from `@cf/meta/llama-guard-3-8b`. */
export function parseLlamaGuardWorkersAiResult(result: unknown): LlamaGuardVerdict | null {
  if (!result || typeof result !== "object") {
    return null;
  }
  const response = (result as { response?: unknown }).response;
  if (typeof response !== "string") {
    return null;
  }
  return parseLlamaGuardVerdictText(response);
}

/** First line must be exactly `safe` or `unsafe`; category codes follow on later lines. */
export function parseLlamaGuardVerdictText(text: string): LlamaGuardVerdict | null {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const verdictLine = lines[0]?.toLowerCase();
  if (!verdictLine) {
    return null;
  }
  if (verdictLine === "safe") {
    return { label: "safe" };
  }
  if (verdictLine !== "unsafe") {
    return null;
  }
  const categorySource = lines.slice(1).join("\n");
  return { label: "unsafe", categories: extractLlamaGuardCategories(categorySource) };
}

function extractLlamaGuardCategories(text: string): string[] {
  const matches = text.match(LLAMA_GUARD_CATEGORY_PATTERN);
  if (!matches) {
    return [];
  }
  return [...new Set(matches)];
}

function decodeText(file: SafetyScannerFile): string | null {
  if (!isTextLike(file)) {
    return null;
  }
  return new TextDecoder().decode(file.bytes.slice(0, 1024 * 1024));
}

function isTextLike(file: SafetyScannerFile): boolean {
  const contentType = file.contentType.toLowerCase();
  if (contentType.startsWith("text/") || contentType.includes("json") || contentType.includes("xml")) {
    return true;
  }
  const dot = file.path.lastIndexOf(".");
  if (dot < 0) {
    return false;
  }
  return [".css", ".csv", ".htm", ".html", ".js", ".json", ".md", ".svg", ".txt", ".xml"].includes(
    file.path.slice(dot).toLowerCase(),
  );
}

function isHtmlLike(file: SafetyScannerFile, text: string): boolean {
  return (
    file.contentType.toLowerCase().includes("html") || /\.(?:html?|xhtml)$/i.test(file.path) || /<html[\s>]/i.test(text)
  );
}
