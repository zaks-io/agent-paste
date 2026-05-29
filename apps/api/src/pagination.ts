import type { PaginationInput } from "./env.js";

export function parsePagination(
  request: Request,
): { ok: true; value: PaginationInput } | { ok: false; code: "invalid_cursor" | "invalid_request" } {
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam === null ? 50 : Number(limitParam);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return { ok: false, code: "invalid_request" };
  }
  if (cursor !== undefined && (cursor.length < 1 || cursor.length > 500)) {
    return { ok: false, code: "invalid_cursor" };
  }
  return { ok: true, value: cursor === undefined ? { limit } : { limit, cursor } };
}
