import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  auth: { user: { email: "user@example.com" }, accessToken: "access-token" } as {
    user: { email: string } | null;
    accessToken?: string;
  },
  apiFetchOrEmpty: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({
  getGlobalStartContext: () => ({ auth: () => (state.auth.user ? { ...state.auth, claims: {} } : { user: null }) }),
}));

vi.mock("../src/server/api-client", () => ({
  apiFetchOrEmpty: (...args: unknown[]) => state.apiFetchOrEmpty(...args),
}));

vi.mock("../src/server/runtime", () => ({
  getWebEnv: () => ({ WEB_BASE_URL: "https://app.test" }),
}));

import { listAccessLinks, listArtifactAccessLinks, listArtifactRevisions } from "../src/server/web-loaders";

const ARTIFACT_ID = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";

describe("access link loaders", () => {
  beforeEach(() => {
    state.auth = { user: { email: "user@example.com" }, accessToken: "access-token" };
    state.apiFetchOrEmpty.mockReset();
    state.apiFetchOrEmpty.mockResolvedValue({ data: { items: [] }, empty: false, error: null });
  });

  it("fetches the workspace-wide and per-artifact lists with the member token", async () => {
    await listAccessLinks();
    await listArtifactAccessLinks({ artifactId: ARTIFACT_ID });
    await listArtifactRevisions({ artifactId: ARTIFACT_ID });

    expect(state.apiFetchOrEmpty).toHaveBeenNthCalledWith(1, "/v1/web/access-links", { accessToken: "access-token" });
    expect(state.apiFetchOrEmpty).toHaveBeenNthCalledWith(2, `/v1/web/artifacts/${ARTIFACT_ID}/access-links`, {
      accessToken: "access-token",
    });
    expect(state.apiFetchOrEmpty).toHaveBeenNthCalledWith(3, `/v1/web/artifacts/${ARTIFACT_ID}/revisions`, {
      accessToken: "access-token",
    });
  });

  it("returns an empty fallback without calling the API when signed out", async () => {
    state.auth = { user: null };

    await expect(listAccessLinks()).resolves.toMatchObject({ data: null, empty: true, error: null });
    await expect(listArtifactAccessLinks({ artifactId: ARTIFACT_ID })).resolves.toMatchObject({ empty: true });
    await expect(listArtifactRevisions({ artifactId: ARTIFACT_ID })).resolves.toMatchObject({ empty: true });
    expect(state.apiFetchOrEmpty).not.toHaveBeenCalled();
  });
});
