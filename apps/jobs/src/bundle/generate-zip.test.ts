import { unzipSync } from "fflate";
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

  it("deflates text entries, stores already-compressed ones, and round-trips every file", () => {
    const html = new TextEncoder().encode("<p>repeated</p>".repeat(1000));
    const png = crypto.getRandomValues(new Uint8Array(4096));
    const zip = buildRevisionZip([
      { path: "index.html", bytes: html },
      { path: "images/photo.png", bytes: png },
    ]);

    const compression: Record<string, number> = {};
    const files = unzipSync(zip, {
      filter: (file) => {
        compression[file.name] = file.compression;
        return true;
      },
    });

    expect(compression).toEqual({ "index.html": 8, "images/photo.png": 0 });
    expect(files["index.html"]).toEqual(html);
    expect(files["images/photo.png"]).toEqual(png);
    expect(zip.byteLength).toBeLessThan(png.byteLength + html.byteLength / 10);
  });

  it("packages __proto__ paths without polluting Object.prototype", () => {
    const pollutionProbe = "ap23BundleZipProtoProbe";
    expect((Object.prototype as Record<string, unknown>)[pollutionProbe]).toBeUndefined();

    const zip = buildRevisionZip([{ path: "__proto__", bytes: new Uint8Array([1]) }]);

    expect(zip.byteLength).toBeGreaterThan(0);
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
    expect((Object.prototype as Record<string, unknown>)[pollutionProbe]).toBeUndefined();
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
