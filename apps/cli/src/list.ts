import type { ApiClient } from "@agent-paste/api-client";
import { output, type Parsed, stringFlag } from "./cli-args.js";
export async function list(parsed: Parsed, client: ApiClient) {
  const cursor = stringFlag(parsed, "cursor");
  return output(await client.artifacts.list(cursor ? { cursor } : {}), parsed.global);
}
