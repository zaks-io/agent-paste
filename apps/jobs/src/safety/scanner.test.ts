import { describe, expect, it } from "vitest";
import { createBuiltInSafetyScanner } from "./scanner.js";

const encoder = new TextEncoder();

describe("built-in safety scanner", () => {
  it("flags stable warnings without echoing uploaded secret values", async () => {
    const scanner = createBuiltInSafetyScanner();
    const warnings = await scanner.scan([
      {
        path: "index.html",
        contentType: "text/html; charset=utf-8",
        bytes: encoder.encode(`<form><input type="password" name="pw"></form>`),
      },
      {
        path: "config.txt",
        contentType: "text/plain",
        bytes: encoder.encode("token = 'abcdefghijklmnopqrstuvwxyz123456'"),
      },
    ]);

    expect(warnings).toEqual([
      {
        code: "api_token_literal",
        severity: "info",
        scope: "file",
        file_path: "config.txt",
        message: "This revision contains a string shaped like an API token.",
      },
      {
        code: "credential_collection_form",
        severity: "warning",
        scope: "file",
        file_path: "index.html",
        message: "This revision contains an HTML password form.",
      },
    ]);
    expect(JSON.stringify(warnings)).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });
});
