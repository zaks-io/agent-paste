import { describe, expect, it } from "vitest";
import { createRouteBoundaryFixture } from "./route-boundary-fixture.js";

describe("route boundary fixture", () => {
  it("seeds two workspaces with published artifacts for route tests", async () => {
    const fixture = await createRouteBoundaryFixture();
    expect(fixture.workspaceA.id).not.toBe(fixture.workspaceB.id);
    expect(fixture.workspaceA.published.artifactId).toBeTruthy();
    expect(fixture.workspaceA.accessLinkId).toBeTruthy();
    expect(fixture.workspaceA.pendingUploadSessionId).toBeTruthy();
  }, 240_000);
});
