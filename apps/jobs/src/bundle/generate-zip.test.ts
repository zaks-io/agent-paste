import { describe, expect, it } from "vitest";
import { buildRevisionZip } from "./generate-zip.js";

describe("buildRevisionZip", () => {
  it("packages revision files into a zip archive", () => {
    const zip = buildRevisionZip([
      { path: "index.html", bytes: new TextEncoder().encode("<html></html>") },
      { path: "assets/app.js", bytes: new TextEncoder().encode("console.log('ok')") },
    ]);
    expect(zip.byteLength).toBeGreaterThan(0);
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
  });

  it("rejects duplicate revision paths deterministically", () => {
    const bytes = new TextEncoder().encode("x");
    expect(() =>
      buildRevisionZip([
        { path: "index.html", bytes },
        { path: "index.html", bytes },
      ]),
    ).toThrow("duplicate_revision_path:index.html");
  });
});
