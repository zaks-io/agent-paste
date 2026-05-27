export function logOp(event: string, fields: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      level: "info",
      component: "jobs",
      event,
      at: new Date().toISOString(),
      ...fields,
    }),
  );
}

export function logOpError(event: string, fields: Record<string, unknown>): void {
  console.error(
    JSON.stringify({
      level: "error",
      component: "jobs",
      event,
      at: new Date().toISOString(),
      ...fields,
    }),
  );
}
