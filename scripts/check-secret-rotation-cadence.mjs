import { readFile } from "node:fs/promises";

const DEFAULT_RECORD_PATH = new URL("../ops/secret-rotation-cadence.json", import.meta.url);

export function evaluateRotationCadence(record, now = new Date()) {
  if (!Number.isInteger(record.maximumAgeDays) || record.maximumAgeDays <= 0) {
    throw new Error("maximumAgeDays must be a positive integer");
  }

  const lastRotatedAt = record.signingKeys?.lastRotatedAt;
  if (lastRotatedAt === null) {
    return {
      overdue: true,
      reason: "Production signing-key rotation has no verified completion timestamp.",
    };
  }
  if (typeof lastRotatedAt !== "string") {
    throw new Error("signingKeys.lastRotatedAt must be an RFC3339 timestamp or null");
  }

  const rotatedAt = new Date(lastRotatedAt);
  if (Number.isNaN(rotatedAt.getTime()) || rotatedAt.toISOString() !== lastRotatedAt) {
    throw new Error("signingKeys.lastRotatedAt must be a canonical RFC3339 timestamp");
  }

  const dueAt = new Date(rotatedAt.getTime() + record.maximumAgeDays * 24 * 60 * 60 * 1000);
  return {
    overdue: now >= dueAt,
    dueAt: dueAt.toISOString(),
    reason: `Production signing keys are due for rotation by ${dueAt.toISOString()}.`,
  };
}

async function main() {
  const recordPath = process.argv[2] ? new URL(process.argv[2], `file://${process.cwd()}/`) : DEFAULT_RECORD_PATH;
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  const result = evaluateRotationCadence(record);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.overdue ? 2 : 0;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  await main();
}
