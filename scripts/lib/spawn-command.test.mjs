import { describe, expect, it } from "vitest";
import { spawnCommand } from "./spawn-command.mjs";

const node = process.execPath;

describe("spawnCommand", () => {
  it("captures stdout and stderr on success (default mode)", async () => {
    const result = await spawnCommand(node, ["-e", "process.stdout.write('out'); process.stderr.write('err');"], {
      quiet: true,
    });
    expect(result).toEqual({ code: 0, stdout: "out", stderr: "err" });
  });

  it("rejects with the captured body on a non-zero exit", async () => {
    await expect(
      spawnCommand(node, ["-e", "process.stderr.write('boom'); process.exit(2);"], { quiet: true }),
    ).rejects.toThrow(/exited 2\nboom/);
  });

  it("resolves a non-zero exit when allowFailure is set", async () => {
    const result = await spawnCommand(node, ["-e", "process.exit(3);"], {
      allowFailure: true,
      quiet: true,
    });
    expect(result.code).toBe(3);
  });

  it("passes env overrides through to the child", async () => {
    const result = await spawnCommand(node, ["-e", "process.stdout.write(process.env.SPAWN_TEST ?? '')"], {
      quiet: true,
      env: { SPAWN_TEST: "value" },
    });
    expect(result.stdout).toBe("value");
  });

  it("does not capture output in inherit mode on success", async () => {
    const result = await spawnCommand(node, ["-e", "process.stdout.write('ignored')"], {
      inherit: true,
    });
    expect(result).toEqual({ code: 0, stdout: "", stderr: "" });
  });

  it("captures output in inherit mode only when allowFailure is set", async () => {
    const result = await spawnCommand(node, ["-e", "process.stderr.write('captured'); process.exit(1);"], {
      inherit: true,
      allowFailure: true,
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toBe("captured");
  });

  it("rejects when the command cannot be spawned", async () => {
    await expect(spawnCommand("this-binary-does-not-exist-xyz", [])).rejects.toThrow();
  });
});
