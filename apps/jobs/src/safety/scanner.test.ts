import { describe, expect, it } from "vitest";
import { createBuiltInSafetyScanner } from "./scanner.js";

const encoder = new TextEncoder();
const tokenValue = "abcdefghijkl" + "mnopqrstuvwxyz123456";
const awsAccessKeyId = "AKIA" + "ABCDEFGHIJKLMNOP";
const temporaryAwsAccessKeyId = "ASIA" + "ABCDEFGHIJKLMNOP";
const privateKeyMarker = "-----BEGIN " + "PRIVATE KEY-----";

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
        bytes: encoder.encode(`token = '${tokenValue}'`),
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
    expect(JSON.stringify(warnings)).not.toContain(tokenValue);
  });

  it("scans text-like files by extension and skips binary files", async () => {
    const scanner = createBuiltInSafetyScanner();
    const warnings = await scanner.scan([
      {
        path: "archive.bin",
        contentType: "application/octet-stream",
        bytes: encoder.encode(awsAccessKeyId),
      },
      {
        path: "keys.md",
        contentType: "application/octet-stream",
        bytes: encoder.encode(privateKeyMarker),
      },
      {
        path: "identity",
        contentType: "application/json",
        bytes: encoder.encode(`{"key":"${temporaryAwsAccessKeyId}"}`),
      },
    ]);

    expect(warnings).toEqual([
      {
        code: "cloud_secret_identifier",
        severity: "warning",
        scope: "file",
        file_path: "identity",
        message: "This revision appears to include a cloud credential identifier.",
      },
      {
        code: "private_key_material",
        severity: "warning",
        scope: "file",
        file_path: "keys.md",
        message: "This revision appears to include private key material.",
      },
    ]);
  });

  it("detects HTML password forms by path when content type is generic", async () => {
    const scanner = createBuiltInSafetyScanner();

    await expect(
      scanner.scan([
        {
          path: "signin.html",
          contentType: "application/octet-stream",
          bytes: encoder.encode(`<form><input type=password></form>`),
        },
      ]),
    ).resolves.toEqual([
      {
        code: "credential_collection_form",
        severity: "warning",
        scope: "file",
        file_path: "signin.html",
        message: "This revision contains an HTML password form.",
      },
    ]);
  });

  it("detects HTML password forms with mixed-case content types", async () => {
    const scanner = createBuiltInSafetyScanner();

    await expect(
      scanner.scan([
        {
          path: "signin",
          contentType: "Text/HTML; charset=utf-8",
          bytes: encoder.encode(`<form><input type=password></form>`),
        },
      ]),
    ).resolves.toEqual([
      {
        code: "credential_collection_form",
        severity: "warning",
        scope: "file",
        file_path: "signin",
        message: "This revision contains an HTML password form.",
      },
    ]);
  });

  it("sorts multiple warnings for the same file by code", async () => {
    const scanner = createBuiltInSafetyScanner();
    const warnings = await scanner.scan([
      {
        path: "index.html",
        contentType: "text/html",
        bytes: encoder.encode(`<form><input type="password"></form>\n${privateKeyMarker}`),
      },
    ]);

    expect(warnings.map((warning) => warning.code)).toEqual(["credential_collection_form", "private_key_material"]);
  });
});
