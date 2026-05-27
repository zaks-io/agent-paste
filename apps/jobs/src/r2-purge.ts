import type { R2Bucket } from "./env.js";

export async function deletePrefixes(bucket: R2Bucket, prefixes: string[]): Promise<number> {
  let deleted = 0;
  for (const prefix of prefixes) {
    deleted += await deletePrefix(bucket, prefix);
  }
  return deleted;
}

async function deletePrefix(bucket: R2Bucket, prefix: string): Promise<number> {
  let deleted = 0;
  let cursor: string | undefined;
  do {
    const listOptions: { prefix: string; cursor?: string } = { prefix };
    if (cursor) {
      listOptions.cursor = cursor;
    }
    const page = await bucket.list(listOptions);
    const keys = page.objects.map((object) => object.key);
    if (keys.length > 0) {
      await bucket.delete(keys);
      deleted += keys.length;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return deleted;
}
