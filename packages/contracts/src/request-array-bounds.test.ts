import { describe, expect, it } from "vitest";
import * as z from "zod";
import { AgentIdentityRequest } from "./agentAuth.js";
import { JobsQueueMessage } from "./jobs.js";
import { LiveUpdateAuthorizeAccessLinkRequest, LiveUpdateNotifyMessage } from "./liveUpdates.js";
import { LiftLockdownRequest } from "./lockdown.js";
import { McpJsonRpcRequest, McpToolCallParams } from "./mcp/jsonrpc.js";
import { McpMultiEditInput } from "./mcp/schemas.js";
import { mcpToolInputSchemas } from "./mcp/tool-schemas.js";
import { requestSchemas } from "./routes/request-schemas.js";
import { CreateUploadSessionRequest } from "./uploadSessions.js";

// Array caps must be enforced before items are validated (patches/zod@4.4.3.patch),
// so an oversized list costs one issue instead of one parse per item. Every array
// reachable from an external request therefore needs a finite, small maximum.
const MAX_REQUEST_ARRAY_ITEMS = 100;

const externalRequestSchemas: Record<string, z.ZodType> = {
  ...Object.fromEntries(Object.entries(requestSchemas).map(([name, schema]) => [`api.${name}`, schema])),
  ...Object.fromEntries(Object.entries(mcpToolInputSchemas).map(([name, schema]) => [`mcp.${name}`, schema])),
  AgentIdentityRequest,
  LiftLockdownRequest,
  McpJsonRpcRequest,
  McpToolCallParams,
  LiveUpdateAuthorizeAccessLinkRequest,
  LiveUpdateNotifyMessage,
  JobsQueueMessage,
};

type ArrayBound = { path: string; maximum: unknown };
type SchemaDef = { type: string } & Record<string, unknown>;

const leafTypes = new Set([
  "string",
  "number",
  "boolean",
  "literal",
  "enum",
  "null",
  "undefined",
  "never",
  "transform",
  "unknown",
]);
const wrapperTypes = new Set(["optional", "nullable", "default", "prefault", "catch", "readonly", "nonoptional"]);

function schemaDef(schema: unknown, path: string): SchemaDef {
  const def = (schema as { _zod?: { def?: SchemaDef } } | undefined)?._zod?.def;
  if (typeof def?.type !== "string") throw new Error(`Missing Zod definition at ${path}`);
  return def;
}

function child(def: SchemaDef, key: string, path: string): unknown {
  if (def[key] === undefined) throw new Error(`Missing ${def.type}.${key} at ${path}`);
  return def[key];
}

function children(def: SchemaDef, key: string, path: string): unknown[] {
  const value = child(def, key, path);
  if (!Array.isArray(value)) throw new Error(`Expected ${def.type}.${key} array at ${path}`);
  return value;
}

// Fails closed: an unrecognized schema kind could hide an unbounded array.
function collectArrayBounds(schema: unknown, path: string, found: ArrayBound[] = []): ArrayBound[] {
  const def = schemaDef(schema, path);
  if (leafTypes.has(def.type)) return found;
  if (wrapperTypes.has(def.type)) return collectArrayBounds(child(def, "innerType", path), path, found);
  switch (def.type) {
    case "array":
      found.push({ path, maximum: (schema as z.ZodArray)._zod.bag.maximum });
      return collectArrayBounds(child(def, "element", path), `${path}[]`, found);
    case "object": {
      const shape = child(def, "shape", path) as Record<string, unknown>;
      for (const [key, value] of Object.entries(shape)) collectArrayBounds(value, `${path}.${key}`, found);
      if (def.catchall !== undefined) collectArrayBounds(def.catchall, `${path}.*`, found);
      return found;
    }
    case "union":
      for (const [index, option] of children(def, "options", path).entries()) {
        collectArrayBounds(option, `${path}|${index}`, found);
      }
      return found;
    case "intersection":
      collectArrayBounds(child(def, "left", path), path, found);
      return collectArrayBounds(child(def, "right", path), path, found);
    case "pipe":
      collectArrayBounds(child(def, "in", path), path, found);
      return collectArrayBounds(child(def, "out", path), path, found);
    case "record":
      collectArrayBounds(child(def, "keyType", path), `${path}{key}`, found);
      return collectArrayBounds(child(def, "valueType", path), `${path}{value}`, found);
    case "tuple":
      for (const [index, item] of children(def, "items", path).entries()) {
        collectArrayBounds(item, `${path}[${index}]`, found);
      }
      if (def.rest !== null && def.rest !== undefined) collectArrayBounds(def.rest, `${path}[...]`, found);
      return found;
    default:
      throw new Error(`Unexpected ${def.type} schema at ${path}`);
  }
}

const sha = "a".repeat(64);
const baseRevisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";

function uploadFiles(count: number) {
  return Array.from({ length: count }, (_, index) => ({ path: `file-${index}.txt`, size_bytes: 1, sha256: sha }));
}

function uploadRequest(overrides: Record<string, unknown>) {
  return { title: "doc", entrypoint: "file-0.txt", files: uploadFiles(1), ...overrides };
}

function multiEditRequest(edits: unknown[]) {
  return { artifact_id: artifactId, path: "index.html", edits };
}

function expectSingleTooBig(result: z.ZodSafeParseResult<unknown>, path: PropertyKey[]) {
  expect(result.success).toBe(false);
  expect(result.error?.issues).toEqual([
    expect.objectContaining({ code: "too_big", origin: "array", maximum: MAX_REQUEST_ARRAY_ITEMS, path }),
  ]);
}

describe("external request array bounds", () => {
  it.each(Object.entries(externalRequestSchemas))("%s caps every array", (_name, schema) => {
    const unbounded = collectArrayBounds(schema, "$").filter(
      ({ maximum }) => typeof maximum !== "number" || !Number.isFinite(maximum) || maximum > MAX_REQUEST_ARRAY_ITEMS,
    );
    expect(unbounded).toEqual([]);
  });

  it("walks into the request arrays that accept caller-sized lists", () => {
    const paths = Object.entries(externalRequestSchemas).flatMap(([name, schema]) =>
      collectArrayBounds(schema, name).map(({ path }) => path),
    );
    expect(paths).toEqual(
      expect.arrayContaining([
        "api.CreateUploadSessionRequest.files",
        "api.CreateUploadSessionRequest.deleted_paths",
        "mcp.multi_edit.edits",
        "JobsQueueMessage|0.prefixes",
      ]),
    );
  });

  it("fails closed on schema kinds the walk does not understand", () => {
    expect(() => collectArrayBounds(z.object({ items: z.set(z.string()) }), "$")).toThrow(
      "Unexpected set schema at $.items",
    );
    expect(() =>
      collectArrayBounds(
        z.lazy(() => z.array(z.string())),
        "$",
      ),
    ).toThrow("Unexpected lazy schema at $");
    expect(() => collectArrayBounds({}, "$")).toThrow("Missing Zod definition at $");
  });
});

describe("oversized request arrays stop before item validation", () => {
  it("rejects 1000 invalid files with one too_big issue", () => {
    const files = Array.from({ length: 1000 }, () => ({}));
    expectSingleTooBig(CreateUploadSessionRequest.safeParse(uploadRequest({ files })), ["files"]);
  });

  it("rejects 1000 invalid deleted_paths with one too_big issue", () => {
    const deleted_paths = Array.from({ length: 1000 }, () => "../escape");
    expectSingleTooBig(
      CreateUploadSessionRequest.safeParse(uploadRequest({ base_revision_id: baseRevisionId, deleted_paths })),
      ["deleted_paths"],
    );
  });

  it("rejects 1000 invalid edits with one too_big issue", () => {
    const edits = Array.from({ length: 1000 }, () => ({ old_string: "" }));
    expectSingleTooBig(McpMultiEditInput.safeParse(multiEditRequest(edits)), ["edits"]);
  });

  it("rejects one entry over the cap even when every entry is valid", () => {
    expectSingleTooBig(CreateUploadSessionRequest.safeParse(uploadRequest({ files: uploadFiles(101) })), ["files"]);
  });

  it("returns the same single issue from async parsing", async () => {
    const files = Array.from({ length: 1000 }, () => ({}));
    expectSingleTooBig(await CreateUploadSessionRequest.safeParseAsync(uploadRequest({ files })), ["files"]);
  });

  it("never runs async item checks for an oversized array", async () => {
    let itemChecks = 0;
    const schema = z
      .array(
        z.string().refine(async () => {
          itemChecks += 1;
          return true;
        }),
      )
      .max(MAX_REQUEST_ARRAY_ITEMS);

    expectSingleTooBig(await schema.safeParseAsync(Array.from({ length: 1000 }, () => "x")), []);
    expect(itemChecks).toBe(0);

    expect((await schema.safeParseAsync(Array.from({ length: 100 }, () => "x"))).success).toBe(true);
    expect(itemChecks).toBe(100);
  });
});

describe("bounded request arrays keep item detail", () => {
  it("accepts a valid 100-file request", () => {
    const result = CreateUploadSessionRequest.safeParse(uploadRequest({ files: uploadFiles(100) }));
    expect(result.success).toBe(true);
    expect(result.data?.files).toHaveLength(100);
  });

  it("reports the invalid file inside a full list", () => {
    const files = uploadFiles(100).map((file, index) => (index === 42 ? { ...file, size_bytes: -1 } : file));
    const result = CreateUploadSessionRequest.safeParse(uploadRequest({ files }));
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ code: "too_small", path: ["files", 42, "size_bytes"] }),
    ]);
  });

  it("reports the invalid deleted path inside a full list", () => {
    const deleted_paths = Array.from({ length: 100 }, (_, index) => (index === 7 ? "../escape" : `gone-${index}.txt`));
    const result = CreateUploadSessionRequest.safeParse(
      uploadRequest({ base_revision_id: baseRevisionId, deleted_paths }),
    );
    expect(result.error?.issues).toEqual([expect.objectContaining({ code: "custom", path: ["deleted_paths", 7] })]);
  });

  it("reports the invalid edit inside a full list", () => {
    const edits = Array.from({ length: 100 }, (_, index) => ({ old_string: index === 99 ? "" : "a", new_string: "b" }));
    const result = McpMultiEditInput.safeParse(multiEditRequest(edits));
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ code: "too_small", path: ["edits", 99, "old_string"] }),
    ]);
  });
});
