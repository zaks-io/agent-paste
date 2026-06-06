import { getBoundResponders } from "@agent-paste/worker-runtime";
import type { AppContext } from "../env.js";

export async function enforceArtifactRateLimit(
  context: AppContext,
  artifactId: string,
  options: { failureLogMessage?: string } = {},
): Promise<Response | null> {
  const binding = context.env.ARTIFACT_RATE_LIMIT;
  if (!binding) {
    return getBoundResponders(context).respondError("rate_limited_artifact", { headers: { "Retry-After": "60" } });
  }
  try {
    const outcome = await binding.limit({ key: artifactId });
    if (!outcome.success) {
      return getBoundResponders(context).respondError("rate_limited_artifact", { headers: { "Retry-After": "60" } });
    }
  } catch (error) {
    console.warn(
      options.failureLogMessage ?? "Artifact rate limit binding failed; denying resolved artifact view.",
      error,
    );
    return getBoundResponders(context).respondError("rate_limited_artifact", { headers: { "Retry-After": "60" } });
  }
  return null;
}
