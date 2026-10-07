import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));

export function resolveSentryRelease(env = process.env) {
  const release =
    env.SENTRY_RELEASE?.trim() || execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  if (!release || /\p{Cc}/u.test(release)) {
    throw new Error("SENTRY_RELEASE must be a non-empty release name without control characters.");
  }
  return release;
}
