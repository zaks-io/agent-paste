import { describe, expect, it } from "vitest";
import { entrypointPathFromViewUrl } from "./agent-view.js";

describe("agent view signing helpers", () => {
  it("decodes valid entrypoint paths from view URLs", () => {
    expect(entrypointPathFromViewUrl("https://content.test/v/art.rev/nested%2Findex.html")).toBe("nested/index.html");
  });

  it("keeps malformed encoded entrypoint paths from throwing", () => {
    expect(entrypointPathFromViewUrl("https://content.test/v/art.rev/%E0%A4%A")).toBe("%E0%A4%A");
  });
});
