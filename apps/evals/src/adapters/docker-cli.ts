import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";

export async function runDocker(
  args: string[],
  timeoutMs: number,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const child = spawnDocker(args);
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMs);
  return new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`docker_timeout:${args[0] ?? "command"}`));
        return;
      }
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

export function spawnDocker(args: string[]): ChildProcessWithoutNullStreams {
  return spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
}

export function dockerEnvArgs(env: Record<string, string>): string[] {
  return Object.entries(env)
    .filter(([key]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([key, value]) => ["--env", `${key}=${value}`]);
}
