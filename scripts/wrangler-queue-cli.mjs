/** True when wrangler queues create failed because the queue already exists. */
export function isQueueAlreadyExists(result) {
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.toLowerCase();
  return (
    output.includes("already exists") ||
    output.includes("queue already created") ||
    output.includes("already taken") ||
    output.includes("[code: 11009]")
  );
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

/** True when a queue consumer remove failed because the consumer is already absent. */
export function isQueueConsumerNotFound(result) {
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.toLowerCase();
  return (
    isQueueNotFound(result) ||
    output.includes("not a consumer") ||
    output.includes("no consumer") ||
    output.includes("no worker consumer") ||
    output.includes("consumer does not exist") ||
    output.includes("consumer not found") ||
    output.includes("not configured as a consumer")
  );
}

/**
 * True when a wrangler call failed with Cloudflare's generic "unknown error"
 * (code 10013, workers.api.error.unknown). This is a transient server-side
 * fault — common when CI hits the Workers/Queues API in bursts — and is safe
 * to retry rather than fail the whole deploy.
 */
export function isTransientApiError(result) {
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.toLowerCase();
  return output.includes("[code: 10013]") || output.includes("workers.api.error.unknown");
}

/** True when Cloudflare refuses to delete a queue because a Worker still references it. */
export function isQueueStillReferenced(result) {
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.toLowerCase();
  return (
    output.includes("still referenced by a binding in a worker") ||
    output.includes("unbind queue") ||
    output.includes("[code: 11005]")
  );
}
