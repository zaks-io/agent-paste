/** True when wrangler queues create failed because the queue already exists. */
export function isQueueAlreadyExists(result) {
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.toLowerCase();
  return output.includes("already exists") || output.includes("queue already created");
}

/** True when wrangler queues delete failed because the queue is absent. */
export function isQueueNotFound(result) {
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.toLowerCase();
  return (
    output.includes("does not exist") ||
    output.includes("not found") ||
    output.includes("could not find") ||
    output.includes("no queue")
  );
}
