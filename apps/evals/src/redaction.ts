const SECRET_NAMES = [
  "OPENROUTER_API_KEY",
  "DAYTONA_API_KEY",
  "DAYTONA_JWT_TOKEN",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
];

export function redactSensitiveText(content: string, env: Record<string, string | undefined> = {}): string {
  let redacted = sanitizeText(content)
    .replace(secretAssignmentPattern(), "$1[redacted]")
    .replace(secretJsonPattern(), '$1"[redacted]"')
    .replace(/sk-or-v1-[A-Za-z0-9]+/g, "[redacted]");
  for (const value of Object.values(secretEnvValues(env))) {
    redacted = redacted.split(value).join("[redacted]");
  }
  return redacted;
}

function secretEnvValues(env: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    SECRET_NAMES.map((name) => [name, env[name]])
      .filter((entry): entry is [string, string] => Boolean(entry[1]))
      .filter(([, value]) => value.length >= 8),
  );
}

function secretAssignmentPattern(): RegExp {
  return new RegExp(`\\b((?:${SECRET_NAMES.join("|")})=)[^\\s\\\\"']+`, "g");
}

function secretJsonPattern(): RegExp {
  return new RegExp(`\\b((?:${SECRET_NAMES.join("|")})["']?\\s*:\\s*)["'][^"']+["']`, "g");
}

function sanitizeText(content: string): string {
  return Array.from(content)
    .filter((character) => character === "\n" || character === "\r" || character === "\t" || character >= " ")
    .join("");
}
