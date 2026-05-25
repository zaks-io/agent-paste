export function lockdownRow(reasonCode = "abuse") {
  return {
    scope: "workspace",
    target_id: "00000000-0000-4000-8000-000000000000",
    reason_code: reasonCode,
    set_at: "2026-01-01T00:00:00.000Z",
    set_by: "operator@example.com",
    lifted_at: null,
    lifted_by: null,
  };
}
