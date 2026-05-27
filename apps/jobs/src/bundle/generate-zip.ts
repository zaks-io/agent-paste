import { zipSync } from "fflate";

export function buildRevisionZip(files: ReadonlyArray<{ path: string; bytes: Uint8Array }>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) {
    entries[file.path] = file.bytes;
  }
  return zipSync(entries);
}
