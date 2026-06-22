import type { CliArgs } from "./types";

export function parseArgs(argv: string[]): CliArgs {
  const [command = "help", ...rest] = stripPnpmSeparators(argv);
  if (command === "run") {
    const outputDir = stringFlag(rest, "--output");
    return {
      command,
      configPath: stringFlag(rest, "--config") ?? "apps/evals/config.example.yaml",
      dryRun: boolFlag(rest, "--dry-run"),
      fresh: boolFlag(rest, "--fresh"),
      harnessIds: harnessFlags(rest),
      modelIds: modelFlags(rest),
      ...(outputDir ? { outputDir } : {}),
      noJudge: boolFlag(rest, "--no-judge"),
    };
  }
  if (command === "report") {
    return { command, resultDir: positional(rest, 0) ?? "eval-results/latest", refresh: boolFlag(rest, "--refresh") };
  }
  if (command === "models") {
    const subcommand = positional(rest, 0);
    if (subcommand !== "refresh") {
      return { command: "help" };
    }
    const outputPath = stringFlag(rest, "--output");
    return { command, ...(outputPath ? { outputPath } : {}) };
  }
  if (command === "snapshot") {
    const subcommand = positional(rest, 0);
    if (subcommand !== "create") {
      return { command: "help" };
    }
    return {
      command,
      configPath: stringFlag(rest, "--config") ?? "apps/evals/config.example.yaml",
      dryRun: boolFlag(rest, "--dry-run"),
    };
  }
  if (command === "env") {
    const subcommand = positional(rest, 0);
    if (subcommand !== "copy") {
      return { command: "help" };
    }
    const sourcePath = stringFlag(rest, "--source");
    const targetPath = stringFlag(rest, "--target");
    return {
      command,
      ...(sourcePath ? { sourcePath } : {}),
      ...(targetPath ? { targetPath } : {}),
      dryRun: boolFlag(rest, "--dry-run"),
    };
  }
  return { command: "help" };
}

function stripPnpmSeparators(argv: string[]): string[] {
  let firstCommandIndex = 0;
  while (firstCommandIndex < argv.length && argv[firstCommandIndex] === "--") {
    firstCommandIndex += 1;
  }
  return argv.slice(firstCommandIndex);
}

function stringFlag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) {
    const prefix = `${name}=`;
    return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  }
  if (index + 1 >= argv.length) {
    return undefined;
  }
  return argv[index + 1];
}

function boolFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function modelFlags(argv: string[]): string[] {
  return repeatedCsvFlags(argv, "--model", "--models");
}

function harnessFlags(argv: string[]): string[] {
  return repeatedCsvFlags(argv, "--harness", "--harnesses");
}

function repeatedCsvFlags(argv: string[], single: string, plural: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === single && next) {
      values.push(next);
      index += 1;
      continue;
    }
    if (arg?.startsWith(`${single}=`)) {
      values.push(arg.slice(`${single}=`.length));
      continue;
    }
    if (arg === plural && next) {
      values.push(...next.split(","));
      index += 1;
      continue;
    }
    if (arg?.startsWith(`${plural}=`)) {
      values.push(...arg.slice(`${plural}=`.length).split(","));
    }
  }
  return values.map((value) => value.trim()).filter(Boolean);
}

function positional(argv: string[], index: number): string | undefined {
  return argv.filter((arg) => !arg.startsWith("--"))[index];
}
