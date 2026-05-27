import { zipSync } from "fflate";

export function buildRevisionZip(files: ReadonlyArray<{ path: string; bytes: Uint8Array }>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) {
    if (Object.hasOwn(entries, file.path)) {
      throw new Error(`duplicate_revision_path:${file.path}`);
    }
    entries[file.path] = file.bytes;
  }
  return zipSync(entries);
}
