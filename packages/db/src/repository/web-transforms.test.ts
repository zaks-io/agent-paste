import { describe, expect, it } from "vitest";
import type { Artifact } from "../types.js";
import { toWebArtifactRow, webArtifactStatus } from "./web-transforms.js";

const base: Artifact = {
  id: "art_1",
  workspace_id: "ws_1",
  revision_id: "rev_1",
  status: "active",
  title: "Demo",
  entrypoint: "index.html",
  file_count: 1,
  size_bytes: 1,
  expires_at: "2026-02-01T00:00:00.000Z",
  pinned_at: null,
  created_by_api_key_id: "key_1",
  access_link_lockdown_at: null,
  deleted_at: null,
  delete_reason: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe("web artifact transforms", () => {
  it("maps lifecycle and pinning fields for dashboard rows", () => {
    expect(webArtifactStatus({ ...base, status: "deleted" })).toBe("Deleted");
    expect(webArtifactStatus({ ...base, status: "expired" })).toBe("Expired");
    expect(webArtifactStatus(base)).toBe("Published");

    expect(toWebArtifactRow({ ...base, pinned_at: "2026-01-02T00:00:00.000Z" })).toMatchObject({
      pinned: true,
      lockdown: false,
      auto_delete_at: null,
    });
    expect(
      toWebArtifactRow({ ...base, access_link_lockdown_at: "2026-01-02T00:00:00.000Z" }),
    ).toMatchObject({
      pinned: false,
      lockdown: true,
      auto_delete_at: base.expires_at,
    });
    expect(toWebArtifactRow({ ...base, status: "deleted" })).toMatchObject({
      status: "Deleted",
      auto_delete_at: null,
    });
  });
});
