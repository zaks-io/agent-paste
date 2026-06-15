import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ApiClient } from "@agent-paste/api-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { edit } from "./edit.js";
import { parseArgs, readEdits } from "./index.js";
import { EXIT_VALIDATION, exitCodeFor, formatError } from "./render.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "edit-test-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function editsFromFile(json: string) {
  const file = path.join(tmp, "edits.json");
  await fs.writeFile(file, json);
  return readEdits(parseArgs(["edit", "art_1", "index.html", "--edits", file]));
}

describe("readEdits", () => {
  it("maps the snake_case contract to the engine's camelCase Edit", async () => {
    const edits = await editsFromFile(
      JSON.stringify([
        { old_string: "a", new_string: "b" },
        { old_string: "c", new_string: "d", replace_all: true },
      ]),
    );

    expect(edits).toEqual([
      { oldString: "a", newString: "b" },
      { oldString: "c", newString: "d", replaceAll: true },
    ]);
  });

  it("omits replaceAll when not requested rather than emitting false", async () => {
    const [edit] = await editsFromFile(JSON.stringify([{ old_string: "a", new_string: "b" }]));
    expect(edit).not.toHaveProperty("replaceAll");
  });

  it("keeps an empty new_string so a delete edit survives validation", async () => {
    const [edit] = await editsFromFile(JSON.stringify([{ old_string: "gone", new_string: "" }]));
    expect(edit).toEqual({ oldString: "gone", newString: "" });
  });

  it("rejects malformed JSON before any network call", async () => {
    const error = await editsFromFile("not json").catch((e: unknown) => e);
    expect(exitCodeFor(error)).toBe(EXIT_VALIDATION);
    expect(formatError("json", error)).toContain("invalid_edit");
  });

  it("rejects an empty edits array", async () => {
    const error = await editsFromFile("[]").catch((e: unknown) => e);
    expect(exitCodeFor(error)).toBe(EXIT_VALIDATION);
    expect(formatError("json", error)).toContain("invalid_edit");
  });

  it("rejects an empty old_string (fail-loud, never a whole-file replace)", async () => {
    const error = await editsFromFile(JSON.stringify([{ old_string: "", new_string: "x" }])).catch((e: unknown) => e);
    expect(exitCodeFor(error)).toBe(EXIT_VALIDATION);
    expect(formatError("json", error)).toContain("invalid_edit");
    expect((error as { editIndex?: number }).editIndex).toBe(0);
  });

  it("rejects an object payload that is not an array of edits", async () => {
    const error = await editsFromFile(JSON.stringify({ old_string: "a", new_string: "b" })).catch((e: unknown) => e);
    expect(exitCodeFor(error)).toBe(EXIT_VALIDATION);
    expect(formatError("json", error)).toContain("invalid_edit");
  });
});

const ARTIFACT_ID = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const REVISION_ID = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const PRIVATE_URL = "https://app.example/v/art_1";

async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Base read with one editable text file. The no-op and non-matching-edit paths both
// short-circuit in the engine before any publish transport call, so a reader-only fake
// is enough to exercise the CLI `edit` glue (payload shaping + error classification).
// The file sha256 is the real digest of `body` so a no-op edit compares equal.
async function readerOnlyClient(body: string): Promise<ApiClient> {
  const sha = await sha256Hex(body);
  return {
    artifacts: {
      getAgentView: async () => ({
        artifact_id: ARTIFACT_ID,
        revision_id: REVISION_ID,
        title: "Original Title",
        created_at: "2026-01-01T00:00:00.000Z",
        expires_at: "2026-12-31T00:00:00.000Z",
        entrypoint: "index.html",
        revision_content_url: "https://content.example/r",
        files: [{ path: "index.html", size_bytes: body.length, content_type: "text/html", url: "https://x" }],
        safety_warnings: [],
        bundle: { available: false },
        private_url: PRIVATE_URL,
      }),
      readFile: async () => ({
        path: "index.html",
        sha256: sha,
        size_bytes: body.length,
        content_type: "text/html",
        is_binary: false,
        body,
      }),
    },
  } as unknown as ApiClient;
}

describe("edit command", () => {
  async function editsFile(json: string) {
    const file = path.join(tmp, "edits.json");
    await fs.writeFile(file, json);
    return parseArgs(["edit", ARTIFACT_ID, "index.html", "--edits", file, "--json"]);
  }

  it("echoes the stable link and reports noop when edits reproduce the stored bytes", async () => {
    const writes: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(((value: string, cb?: unknown) => {
      writes.push(value);
      if (typeof cb === "function") (cb as () => void)();
      return true;
    }) as typeof process.stdout.write);
    try {
      // Replace "keep" with "keep": the result equals the stored content -> no revision.
      const parsed = await editsFile(JSON.stringify([{ old_string: "keep", new_string: "keep" }]));
      await edit(parsed, await readerOnlyClient("keep this"));
    } finally {
      spy.mockRestore();
    }
    const payload = JSON.parse(writes.join("")) as Record<string, unknown>;
    expect(payload.noop).toBe(true);
    expect(payload.artifact_id).toBe(ARTIFACT_ID);
    expect(payload.private_url).toBe(PRIVATE_URL);
  });

  it("propagates a non-matching edit as a ReviseError the dispatcher buckets as a validation failure", async () => {
    const parsed = await editsFile(JSON.stringify([{ old_string: "absent", new_string: "x" }]));
    const error = await edit(parsed, await readerOnlyClient("keep this")).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect((error as { name?: string }).name).toBe("ReviseError");
    expect(exitCodeFor(error)).toBe(EXIT_VALIDATION);
    // The CLI classifies a non-matching edit under the stable `invalid_edit` code.
    expect(formatError("json", error)).toContain("invalid_edit");
  });
});
