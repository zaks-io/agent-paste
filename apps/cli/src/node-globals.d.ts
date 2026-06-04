declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  platform: string;
  stdout: { write(value: string): void };
  stderr: { write(value: string): void };
  exitCode: number | undefined;
};

declare const Buffer: {
  from(data: Uint8Array | ArrayBuffer): { toString(encoding: string): string };
  from(data: string, encoding: string): { toString(encoding: string): string };
};

declare module "node:crypto" {
  export interface Hash {
    update(data: Uint8Array<ArrayBuffer> | string): Hash;
    digest(encoding: "hex"): string;
    digest(): Uint8Array;
  }

  export function createHash(algorithm: string): Hash;
  export function randomBytes(size: number): Uint8Array;
}

declare module "node:fs" {
  export const promises: {
    stat(path: string): Promise<{ isFile(): boolean; isDirectory(): boolean; mode: number }>;
    lstat(path: string): Promise<{ isSymbolicLink(): boolean }>;
    mkdir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<string | undefined>;
    mkdtemp(prefix: string): Promise<string>;
    readdir(
      path: string,
      options: { withFileTypes: true },
    ): Promise<Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>>;
    readFile(path: string): Promise<Uint8Array<ArrayBuffer>>;
    readFile(path: string, encoding: "utf8"): Promise<string>;
    writeFile(path: string, data: string | Uint8Array, options?: { mode?: number }): Promise<void>;
    symlink(target: string, path: string): Promise<void>;
    chmod(path: string, mode: number): Promise<void>;
    rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  };
}

declare module "node:os" {
  const os: {
    tmpdir(): string;
    homedir(): string;
    hostname(): string;
  };
  export default os;
}

declare module "node:path" {
  const path: {
    basename(value: string): string;
    dirname(value: string): string;
    extname(value: string): string;
    join(...parts: string[]): string;
    relative(from: string, to: string): string;
    resolve(value: string): string;
    sep: string;
  };
  export default path;
}

declare module "node:util" {
  // Intentionally minimal: this CLI does not depend on @types/node. The single
  // call site (credentials.ts) supplies Result explicitly, so the full Node
  // overload set is unnecessary here.
  export function promisify<Result>(fn: (...args: never[]) => unknown): (...args: unknown[]) => Promise<Result>;
}

declare module "node:child_process" {
  export function execFile(
    file: string,
    args: string[],
    callback?: (error: unknown, stdout: string, stderr: string) => void,
  ): unknown;

  export function spawnSync(
    command: string,
    args: string[],
    options: { encoding: "utf8"; input?: string | undefined },
  ): { status: number | null; stdout: string; stderr: string; error?: Error | undefined };
}

declare module "node:net" {
  export type AddressInfo = { port: number; address: string; family: string };
}

declare module "node:http" {
  export type IncomingMessage = { url?: string; headers: Record<string, string | string[] | undefined> };
  export interface ServerResponse {
    writeHead(status: number, headers?: Record<string, string>): ServerResponse;
    end(body?: string): void;
  }
  export interface Server {
    listen(port: number, host: string, callback: () => void): Server;
    address(): unknown;
    close(callback: () => void): Server;
    once(event: string, listener: (error: Error) => void): Server;
    removeListener(event: string, listener: (error: Error) => void): Server;
  }
  export function createServer(handler: (request: IncomingMessage, response: ServerResponse) => void): Server;
}
