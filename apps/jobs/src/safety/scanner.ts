export type SafetyScannerWarning = {
  code: string;
  severity: "info" | "warning";
  scope: "artifact" | "revision" | "file";
  file_path?: string;
  message: string;
};

export type SafetyScannerFile = {
  path: string;
  contentType: string;
  bytes: Uint8Array;
};

export type SafetyScanner = {
  scan(files: readonly SafetyScannerFile[]): Promise<SafetyScannerWarning[]>;
};

const MAX_TEXT_BYTES = 1024 * 1024;
const TEXT_EXTENSIONS = new Set([".css", ".csv", ".htm", ".html", ".js", ".json", ".md", ".svg", ".txt", ".xml"]);

const RULES: Array<{
  code: string;
  severity: SafetyScannerWarning["severity"];
  message: string;
  test: (file: SafetyScannerFile, text: string) => boolean;
}> = [
  {
    code: "credential_collection_form",
    severity: "warning",
    message: "This revision contains an HTML password form.",
    test: (file, text) =>
      isHtml(file) && /<form[\s>]/i.test(text) && /<input\b[^>]*\btype\s*=\s*["']?password\b/i.test(text),
  },
  {
    code: "private_key_material",
    severity: "warning",
    message: "This revision appears to include private key material.",
    test: (_file, text) => /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(text),
  },
  {
    code: "cloud_secret_identifier",
    severity: "warning",
    message: "This revision appears to include a cloud credential identifier.",
    test: (_file, text) => /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/.test(text),
  },
  {
    code: "api_token_literal",
    severity: "info",
    message: "This revision contains a string shaped like an API token.",
    test: (_file, text) => /\b(?:api[_-]?key|secret|token)\b\s*[:=]\s*["'][A-Za-z0-9._~+/=-]{24,}["']/i.test(text),
  },
];

export function createBuiltInSafetyScanner(): SafetyScanner {
  return {
    async scan(files) {
      const warnings = new Map<string, SafetyScannerWarning>();
      for (const file of files) {
        const text = decodeScannableText(file);
        if (text === null) {
          continue;
        }
        for (const rule of RULES) {
          if (!rule.test(file, text)) {
            continue;
          }
          const warning: SafetyScannerWarning = {
            code: rule.code,
            severity: rule.severity,
            scope: "file",
            file_path: file.path,
            message: rule.message,
          };
          warnings.set(`${warning.code}:${warning.file_path}`, warning);
        }
      }
      return [...warnings.values()].sort((left, right) => {
        const filePath = (left.file_path ?? "").localeCompare(right.file_path ?? "");
        return filePath === 0 ? left.code.localeCompare(right.code) : filePath;
      });
    },
  };
}

function isHtml(file: SafetyScannerFile): boolean {
  return file.contentType.includes("html") || /\.(?:html?|xhtml)$/i.test(file.path);
}

function decodeScannableText(file: SafetyScannerFile): string | null {
  if (!isTextLike(file)) {
    return null;
  }
  return new TextDecoder().decode(file.bytes.slice(0, MAX_TEXT_BYTES));
}

function isTextLike(file: SafetyScannerFile): boolean {
  const contentType = file.contentType.toLowerCase();
  if (contentType.startsWith("text/") || contentType.includes("json") || contentType.includes("xml")) {
    return true;
  }
  const dot = file.path.lastIndexOf(".");
  return dot >= 0 && TEXT_EXTENSIONS.has(file.path.slice(dot).toLowerCase());
}
