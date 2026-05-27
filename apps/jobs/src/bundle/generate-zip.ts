import { Zip, ZipPassThrough } from "fflate";

function concatChunks(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export function buildRevisionZip(files: ReadonlyArray<{ path: string; bytes: Uint8Array }>): Uint8Array {
  const entries = Object.create(null) as Record<string, Uint8Array>;
  for (const file of files) {
    if (Object.hasOwn(entries, file.path)) {
      throw new Error(`duplicate_revision_path:${file.path}`);
    }
    entries[file.path] = file.bytes;
  }

  const chunks: Uint8Array[] = [];
  let error: Error | undefined;
  const zip = new Zip((err, data, final) => {
    if (err) {
      error = err instanceof Error ? err : new Error(String(err));
      return;
    }
    if (data) {
      chunks.push(data);
    }
    if (final && chunks.length === 0) {
      chunks.push(new Uint8Array(0));
    }
  });

  for (const path of Object.keys(entries)) {
    const entry = new ZipPassThrough(path);
    zip.add(entry);
    entry.push(entries[path]!, true);
  }
  zip.end();

  if (error) {
    throw error;
  }
  return concatChunks(chunks);
}
