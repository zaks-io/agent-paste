export class MemoryKVNamespace {
  #values = new Map();

  async get(key) {
    return this.#values.get(key) ?? null;
  }

  async put(key, value) {
    this.#values.set(key, value);
  }
}

export class MemoryR2Bucket {
  #objects = new Map();

  async put(key, value, options = {}) {
    const bytes = await bytesFromBody(value);
    this.#objects.set(key, {
      bytes,
      httpMetadata: {
        contentType: options.httpMetadata?.contentType,
      },
      customMetadata: options.customMetadata,
    });
    return {};
  }

  async head(key) {
    const object = this.#objects.get(key);
    if (!object) {
      return null;
    }
    return this.#objectBody(object);
  }

  async get(key) {
    const object = this.#objects.get(key);
    if (!object) {
      return null;
    }
    return this.#objectBody(object);
  }

  async list(options = {}) {
    const prefix = options.prefix ?? "";
    const keys = [...this.#objects.keys()].filter((key) => key.startsWith(prefix)).sort();
    return { objects: keys.map((key) => ({ key })), truncated: false };
  }

  async delete(keys) {
    const targets = Array.isArray(keys) ? keys : [keys];
    for (const key of targets) {
      this.#objects.delete(key);
    }
  }

  #objectBody(object) {
    return {
      body: new Blob([object.bytes]).stream(),
      size: object.bytes.byteLength,
      customMetadata: object.customMetadata,
      httpMetadata: object.httpMetadata,
      writeHttpMetadata(headers) {
        if (object.httpMetadata.contentType) {
          headers.set("content-type", object.httpMetadata.contentType);
        }
      },
    };
  }
}

async function bytesFromBody(value) {
  if (value === null || value === undefined) {
    return new Uint8Array();
  }
  if (typeof value === "string") {
    return new TextEncoder().encode(value);
  }
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (value instanceof ReadableStream) {
    return new Uint8Array(await new Response(value).arrayBuffer());
  }
  if (typeof value.arrayBuffer === "function") {
    return new Uint8Array(await value.arrayBuffer());
  }
  return new Uint8Array(await new Response(value).arrayBuffer());
}
