import { describe, expect, it, vi } from "vitest";
import { createOrRefreshHyperdrive } from "./create-hyperdrive.mjs";

const CONNECTION_STRING = "postgres://app_role:secret@example.neon.tech/neondb?sslmode=require";

describe("createOrRefreshHyperdrive", () => {
  it("updates an existing Hyperdrive config when the initial lookup finds it", async () => {
    const run = vi.fn(async (_command, args) => {
      if (args.join(" ") === "exec wrangler hyperdrive list") {
        return {
          code: 0,
          stdout: "│ 268691ac27384f3889db150d0515cde9 │ agent-paste-db-pr-475 │ app_role │ ep-empty.example │",
          stderr: "",
        };
      }
      if (args.join(" ").startsWith("exec wrangler hyperdrive update 268691ac27384f3889db150d0515cde9 ")) {
        return { code: 0, stdout: "", stderr: "" };
      }
      throw new Error(`unexpected command: ${args.join(" ")}`);
    });

    await expect(
      createOrRefreshHyperdrive(
        { name: "agent-paste-db-pr-475", connectionString: CONNECTION_STRING },
        { run, log: () => {} },
      ),
    ).resolves.toBe("268691ac27384f3889db150d0515cde9");

    expect(run).not.toHaveBeenCalledWith(
      "pnpm",
      expect.arrayContaining(["create", "agent-paste-db-pr-475"]),
      expect.anything(),
    );
  });

  it("recovers from Cloudflare duplicate-name errors by looking up and updating the existing config", async () => {
    let listCalls = 0;
    const run = vi.fn(async (_command, args) => {
      if (args.join(" ") === "exec wrangler hyperdrive list") {
        listCalls += 1;
        return listCalls === 1
          ? { code: 0, stdout: "", stderr: "" }
          : {
              code: 0,
              stdout: "│ 268691ac27384f3889db150d0515cde9 │ agent-paste-db-pr-475 │ app_role │ ep-empty.example │",
              stderr: "",
            };
      }
      if (args.join(" ").startsWith("exec wrangler hyperdrive create agent-paste-db-pr-475 ")) {
        return {
          code: 1,
          stdout: "",
          stderr: "A Hyperdrive config with the given name already exists [code: 2017]",
        };
      }
      if (args.join(" ").startsWith("exec wrangler hyperdrive update 268691ac27384f3889db150d0515cde9 ")) {
        return { code: 0, stdout: "", stderr: "" };
      }
      throw new Error(`unexpected command: ${args.join(" ")}`);
    });

    await expect(
      createOrRefreshHyperdrive(
        { name: "agent-paste-db-pr-475", connectionString: CONNECTION_STRING },
        { run, log: () => {} },
      ),
    ).resolves.toBe("268691ac27384f3889db150d0515cde9");

    expect(listCalls).toBe(2);
    expect(run).toHaveBeenCalledWith(
      "pnpm",
      ["exec", "wrangler", "hyperdrive", "create", "agent-paste-db-pr-475", "--connection-string", CONNECTION_STRING],
      { allowFailure: true, quiet: true },
    );
    expect(run).toHaveBeenCalledWith(
      "pnpm",
      [
        "exec",
        "wrangler",
        "hyperdrive",
        "update",
        "268691ac27384f3889db150d0515cde9",
        "--connection-string",
        CONNECTION_STRING,
      ],
      { allowFailure: true, quiet: true },
    );
  });

  it("surfaces Hyperdrive list failures instead of treating them as not found", async () => {
    const run = vi.fn(async () => ({ code: 1, stdout: "", stderr: "not authenticated" }));

    await expect(
      createOrRefreshHyperdrive(
        { name: "agent-paste-db-pr-475", connectionString: CONNECTION_STRING },
        { run, log: () => {} },
      ),
    ).rejects.toThrow("not authenticated");

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("creates a new Hyperdrive config when no existing config is found", async () => {
    const run = vi.fn(async (_command, args) => {
      if (args.join(" ") === "exec wrangler hyperdrive list") {
        return { code: 0, stdout: "", stderr: "" };
      }
      if (args.join(" ").startsWith("exec wrangler hyperdrive create agent-paste-db-pr-475 ")) {
        return {
          code: 0,
          stdout: "Created new Hyperdrive PostgreSQL config: 268691ac27384f3889db150d0515cde9",
          stderr: "",
        };
      }
      throw new Error(`unexpected command: ${args.join(" ")}`);
    });

    await expect(
      createOrRefreshHyperdrive(
        { name: "agent-paste-db-pr-475", connectionString: CONNECTION_STRING },
        { run, log: () => {} },
      ),
    ).resolves.toBe("268691ac27384f3889db150d0515cde9");
  });
});
