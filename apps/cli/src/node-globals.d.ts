declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  stdout: { write(value: string): void };
  stderr: { write(value: string): void };
  exitCode: number | undefined;
};

declare module "node:crypto" {
  export interface Hash {
    update(data: Uint8Array<ArrayBuffer>): Hash;
    digest(encoding: "hex"): string;
  }

  export function createHash(algorithm: string): Hash;
}

declare module "node:fs" {
  export const promises: {
    stat(path: string): Promise<{ isFile(): boolean; isDirectory(): boolean }>;
    mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>;
    mkdtemp(prefix: string): Promise<string>;
    readdir(
      path: string,
      options: { withFileTypes: true },
    ): Promise<Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>>;
    readFile(path: string): Promise<Uint8Array<ArrayBuffer>>;
    writeFile(path: string, data: string | Uint8Array): Promise<void>;
  };
}

declare module "node:os" {
  const os: {
    tmpdir(): string;
  };
  export default os;
}

declare module "node:path" {
  const path: {
    basename(value: string): string;
    extname(value: string): string;
    join(...parts: string[]): string;
    relative(from: string, to: string): string;
    resolve(value: string): string;
    sep: string;
  };
  export default path;
}
