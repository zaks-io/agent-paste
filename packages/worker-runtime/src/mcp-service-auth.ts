const internalMcpSubject = Symbol("agent-paste.internal-mcp-subject");

type InternalMcpEnv = {
  [internalMcpSubject]?: string;
};

export function withInternalMcpSubject<TEnv extends object>(env: TEnv, subject: string): TEnv {
  const normalized = normalizeInternalMcpSubject(subject);
  if (!normalized) {
    throw new Error("invalid_internal_mcp_subject");
  }
  const internalEnv = Object.create(env) as TEnv & InternalMcpEnv;
  Object.defineProperty(internalEnv, internalMcpSubject, {
    configurable: false,
    enumerable: false,
    value: normalized,
    writable: false,
  });
  return internalEnv;
}

export function getInternalMcpSubject(env: object): string | null {
  return normalizeInternalMcpSubject((env as InternalMcpEnv)[internalMcpSubject]);
}

function normalizeInternalMcpSubject(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > 255 || containsControlCharacter(normalized)) {
    return null;
  }
  return normalized;
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) {
      return true;
    }
  }
  return false;
}
