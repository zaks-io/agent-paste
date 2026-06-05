import type { SqlExecutor } from "@agent-paste/db";
import type { Env } from "../env.js";

type R2GetObject = NonNullable<NonNullable<Env["ARTIFACTS"]>["get"]>;

type RevisionFileRow = {
  path: string;
  r2_key: string;
  served_content_type: string;
};

type R2ObjectWithBody = {
  body?: ReadableStream | ArrayBuffer | Uint8Array | null;
  arrayBuffer?: () => Promise<ArrayBuffer>;
};

export async function loadScannerFiles(
  executor: SqlExecutor,
  input: {
    artifactId: string;
    revisionId: string;
    getObject: R2GetObject;
  },
): Promise<Array<{ path: string; contentType: string; bytes: Uint8Array }>> {
  const files = await loadRevisionFiles(executor, input.artifactId, input.revisionId);
  const scannerFiles = [];
  for (const file of files) {
    const object = await input.getObject(file.r2_key);
    if (!object?.body) {
      throw new Error(`missing_r2_object:${file.path}`);
    }
    scannerFiles.push({
      path: file.path,
      contentType: file.served_content_type,
      bytes: await readObjectBytes(object),
    });
  }
  return scannerFiles;
}

async function loadRevisionFiles(
  executor: SqlExecutor,
  artifactId: string,
  revisionId: string,
): Promise<RevisionFileRow[]> {
  const result = await executor.query<RevisionFileRow>(
    `select path, r2_key, served_content_type
     from artifact_files
     where artifact_id = $1 and revision_id = $2
     order by path asc`,
    [artifactId, revisionId],
  );
  return result.rows;
}

async function readObjectBytes(object: R2ObjectWithBody): Promise<Uint8Array> {
  if (object.arrayBuffer) {
    return new Uint8Array(await object.arrayBuffer());
  }
  if (object.body instanceof ArrayBuffer) {
    return new Uint8Array(object.body);
  }
  if (object.body instanceof Uint8Array) {
    return object.body;
  }
  if (object.body instanceof ReadableStream) {
    return new Uint8Array(await new Response(object.body).arrayBuffer());
  }
  const unsupportedBody: unknown = object.body;
  const bodyType =
    unsupportedBody === null
      ? "null"
      : unsupportedBody === undefined
        ? "undefined"
        : unsupportedBody instanceof Object
          ? unsupportedBody.constructor.name
          : typeof unsupportedBody;
  throw new Error(`unsupported_r2_object_body:${bodyType}`);
}
