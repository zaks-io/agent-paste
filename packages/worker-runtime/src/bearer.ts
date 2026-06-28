export function bearerToken(request: Request): string | null {
  const value = request.headers.get("authorization");
  return parseBearerToken(value);
}

function parseBearerToken(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!startsWithBearerScheme(trimmed)) {
    return null;
  }
  const token = trimmed.slice("Bearer".length).trimStart();
  return token.length > 0 ? token : null;
}

function startsWithBearerScheme(value: string): boolean {
  if (value.length <= "Bearer".length || value.slice(0, "Bearer".length).toLowerCase() !== "bearer") {
    return false;
  }
  const separator = value.charCodeAt("Bearer".length);
  return separator === 32 || separator === 9;
}
