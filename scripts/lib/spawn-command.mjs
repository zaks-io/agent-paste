import { spawn } from "node:child_process";

function captureStream(stream, append) {
  stream?.on("data", (chunk) => append(chunk.toString()));
}

function echoCaptured(stdout, stderr) {
  if (stdout.trim()) {
    process.stdout.write(stdout);
  }
  if (stderr.trim()) {
    process.stderr.write(stderr);
  }
}

/**
 * Run a child process and resolve with `{ code, stdout, stderr }`.
 *
 * Two output modes, picked by `inherit`:
 * - `inherit: false` (default): always pipe stdout/stderr, capture them, and
 *   echo to the parent unless `quiet`. Use when callers want the captured text.
 * - `inherit: true`: inherit the parent's streams for live output, and only
 *   switch to piping when `allowFailure` is set so the captured body can be
 *   echoed after a tolerated non-zero exit.
 *
 * A non-zero exit rejects unless `allowFailure` is set, in which case it
 * resolves with the captured result.
 */
export function spawnCommand(command, args, options = {}) {
  const { allowFailure = false, quiet = false, inherit = false, env } = options;
  const capture = !inherit || allowFailure;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
      ...(env ? { env: { ...process.env, ...env } } : {}),
    });

    let stdout = "";
    let stderr = "";
    if (capture) {
      captureStream(child.stdout, (text) => {
        stdout += text;
      });
      captureStream(child.stderr, (text) => {
        stderr += text;
      });
    }

    child.on("error", reject);
    child.on("exit", (code) => {
      const result = { code: code ?? 1, stdout, stderr };
      if (result.code !== 0 && !allowFailure) {
        reject(new Error(`${command} ${args.join(" ")} exited ${result.code}\n${stderr || stdout}`.trimEnd()));
        return;
      }
      if (capture && !quiet) {
        echoCaptured(stdout, stderr);
      }
      resolve(result);
    });
  });
}
