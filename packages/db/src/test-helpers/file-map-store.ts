import { serializeRevisionFileMap, workspaceBlobObjectKeyFor } from "@agent-paste/storage";
import type { FileMapStore } from "../repository/persistent-hosting-types.js";

// Explicit fake for workflow fixtures. Production repositories must supply the
// encrypted R2 writer and never acquire an implicit in-memory replacement.
export const fakeFileMapStore: FileMapStore = {
  async write(map) {
    const bytes = serializeRevisionFileMap(map);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
    const sha256 = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
    return {
      sha256,
      size_bytes: bytes.byteLength,
      r2_key: workspaceBlobObjectKeyFor({ workspaceId: map.workspace_id, sha256 }),
    };
  },
};
