function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// zod-to-openapi emits the web cursor params without min/max length bounds; the
// dashboard list endpoints accept opaque cursors of 1..500 chars, so stamp those
// bounds back onto the generated document.
export function applyWebCursorParameterBounds(document: Record<string, unknown>): void {
  const paths = document.paths;
  if (!isRecord(paths)) {
    return;
  }
  for (const path of ["/v1/web/artifacts", "/v1/web/audit", "/v1/web/admin/lockdowns", "/v1/web/admin/events"]) {
    const webListPath = paths[path];
    if (!isRecord(webListPath)) {
      continue;
    }
    const getOperation = webListPath.get;
    if (!isRecord(getOperation) || !Array.isArray(getOperation.parameters)) {
      continue;
    }

    const cursorParameter = getOperation.parameters.find(
      (parameter): parameter is { schema: Record<string, unknown> } =>
        isRecord(parameter) && parameter.name === "cursor" && parameter.in === "query" && isRecord(parameter.schema),
    );
    if (cursorParameter) {
      cursorParameter.schema.minLength = 1;
      cursorParameter.schema.maxLength = 500;
    }
  }
}
