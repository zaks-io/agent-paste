import path from "node:path";
import { Box, Static, Text, useApp, useInput, useStdin } from "ink";
import { useEffect, useMemo, useState } from "react";
import { loadConfig, resolveConfigPath } from "../config";
import { loadEnvFile } from "../env";
import { copyEnvLocal } from "../env-copy";
import { fetchOpenRouterModels, writeModelSnapshot } from "../openrouter";
import { refreshStoredResults } from "../refresh";
import { writeReports } from "../report";
import { readRunResults } from "../result-store";
import { runSuite } from "../runner";
import type { CliArgs, RunEvent, RunResult } from "../types";

type Props = { args: CliArgs };
const FINAL_RENDER_DELAY_MS = 80;

export function App({ args }: Props) {
  if (args.command === "help") {
    return <Help />;
  }
  if (args.command === "run") {
    return <RunView args={args} />;
  }
  if (args.command === "report") {
    return <ReportView refresh={args.refresh} resultDir={args.resultDir} />;
  }
  if (args.command === "models") {
    return <ModelsView {...(args.outputPath ? { outputPath: args.outputPath } : {})} />;
  }
  if (args.command === "env") {
    return <EnvCopyView args={args} />;
  }
  if (args.command === "snapshot") {
    return <SnapshotView configPath={args.configPath} dryRun={args.dryRun} />;
  }
  return <Help />;
}

function RunView({ args }: { args: Extract<CliArgs, { command: "run" }> }) {
  const { exit } = useApp();
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [results, setResults] = useState<RunResult[]>([]);
  const [resultDir, setResultDir] = useState<string>();
  const [error, setError] = useState<string>();
  const { isRawModeSupported } = useStdin();

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const configPath = await resolveConfigPath(args.configPath);
        const config = await loadConfig(configPath);
        const envFile = path.resolve(path.dirname(configPath), config.reporting.env_file);
        const env = { ...processEnv(), ...(await loadEnvFile(envFile)) };
        const output = await runSuite(config, {
          dryRun: args.dryRun,
          fresh: args.fresh,
          harnessIds: args.harnessIds,
          noJudge: args.noJudge,
          modelIds: args.modelIds,
          ...(args.outputDir ? { outputDir: args.outputDir } : {}),
          env,
          onEvent: (event) => {
            if (!cancelled) {
              setEvents((prev) => [...prev, event].slice(-40));
            }
          },
        });
        if (!cancelled) {
          setResultDir(output.resultDir);
          setResults(output.results);
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
        }
      } finally {
        if (!cancelled) {
          setTimeout(exit, FINAL_RENDER_DELAY_MS);
        }
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [args.configPath, args.dryRun, args.fresh, args.harnessIds, args.modelIds, args.noJudge, args.outputDir, exit]);

  const summary = useMemo(() => summarize(results), [results]);
  return (
    <Box flexDirection="column" gap={1}>
      <Header title="Agent Paste evals" />
      <Text dimColor>config {args.configPath}</Text>
      {args.harnessIds.length > 0 ? <Text dimColor>harnesses {args.harnessIds.join(", ")}</Text> : null}
      {args.modelIds.length > 0 ? <Text dimColor>models {args.modelIds.join(", ")}</Text> : null}
      {!args.fresh ? <Text dimColor>resume mode: existing run results are reused</Text> : null}
      {args.fresh ? <Text color="yellow">fresh mode: existing results ignored</Text> : null}
      {args.dryRun ? <Text color="yellow">dry run: no sandboxes or model calls</Text> : null}
      <Box gap={2}>
        <Text color="green">pass {summary.pass}</Text>
        <Text color="yellow">warn {summary.warn}</Text>
        <Text color="red">fail {summary.fail}</Text>
        <Text dimColor>skip {summary.skip}</Text>
        <Text dimColor>total {summary.total}</Text>
      </Box>
      <Static items={events}>{(event, index) => <EventLine key={`${event.at}-${index}`} event={event} />}</Static>
      {resultDir ? <Text color="cyan">results {resultDir}</Text> : null}
      {error ? <Text color="red">error {error}</Text> : null}
      {isRawModeSupported ? <Text dimColor>press q to quit</Text> : null}
      {isRawModeSupported ? <KeyboardShortcuts onQuit={exit} /> : null}
    </Box>
  );
}

function KeyboardShortcuts({ onQuit }: { onQuit: () => void }) {
  useInput((input) => {
    if (input === "q") {
      onQuit();
    }
  });
  return null;
}

function ReportView({ refresh, resultDir }: { refresh: boolean; resultDir: string }) {
  const { exit } = useApp();
  const [message, setMessage] = useState("writing report...");
  useEffect(() => {
    async function run() {
      try {
        const results = refresh ? await refreshStoredResults(resultDir) : await readRunResults(resultDir);
        const files = await writeReports(resultDir, results);
        setMessage(`summary ${files.summaryPath}\naggregate ${files.aggregatePath}`);
      } catch (err) {
        setMessage(`error ${(err as Error).message}`);
      } finally {
        setTimeout(exit, FINAL_RENDER_DELAY_MS);
      }
    }
    void run();
  }, [exit, refresh, resultDir]);
  return (
    <Box flexDirection="column">
      <Header title="Agent Paste eval report" />
      <Text>{message}</Text>
    </Box>
  );
}

function ModelsView({ outputPath }: { outputPath?: string | undefined }) {
  const { exit } = useApp();
  const [message, setMessage] = useState("fetching OpenRouter models...");
  useEffect(() => {
    async function run() {
      try {
        const models = await fetchOpenRouterModels(process.env.OPENROUTER_API_KEY);
        const interesting = models.filter((model) => /claude-(opus|sonnet)|gpt-5\.5/.test(model.id));
        if (outputPath) {
          await writeModelSnapshot(outputPath, models);
        }
        setMessage(interesting.map((model) => `${model.id} ${model.name ?? ""}`).join("\n"));
      } catch (err) {
        setMessage(`error ${(err as Error).message}`);
      } finally {
        setTimeout(exit, FINAL_RENDER_DELAY_MS);
      }
    }
    void run();
  }, [exit, outputPath]);
  return (
    <Box flexDirection="column">
      <Header title="OpenRouter models" />
      <Text>{message}</Text>
    </Box>
  );
}

function EnvCopyView({ args }: { args: Extract<CliArgs, { command: "env" }> }) {
  const { exit } = useApp();
  const [message, setMessage] = useState("copying env...");
  useEffect(() => {
    async function run() {
      try {
        const result = await copyEnvLocal({
          ...(args.sourcePath ? { sourcePath: args.sourcePath } : {}),
          ...(args.targetPath ? { targetPath: args.targetPath } : {}),
          dryRun: args.dryRun,
        });
        const action = args.dryRun ? "would copy" : result.targetExisted ? "updated" : "created";
        const missing =
          result.missingKeys.length > 0
            ? `missing ${result.missingKeys.join(", ")}`
            : `found ${result.presentKeys.join(", ")}`;
        setMessage(
          [`${action} ${result.bytes} bytes`, `from ${result.sourcePath}`, `to   ${result.targetPath}`, missing].join(
            "\n",
          ),
        );
      } catch (err) {
        setMessage(`error ${(err as Error).message}`);
      } finally {
        setTimeout(exit, FINAL_RENDER_DELAY_MS);
      }
    }
    void run();
  }, [args.dryRun, args.sourcePath, args.targetPath, exit]);
  return (
    <Box flexDirection="column">
      <Header title="Eval env" />
      <Text>{message}</Text>
    </Box>
  );
}

function SnapshotView({ configPath, dryRun }: { configPath: string; dryRun: boolean }) {
  return (
    <Box flexDirection="column">
      <Header title="Snapshot setup" />
      <Text color="yellow">Sandbox image setup is documented but not automated by this command yet.</Text>
      <Text>config {configPath}</Text>
      {dryRun ? <Text dimColor>dry-run accepted</Text> : null}
      <Text dimColor>Docker builds the configured image on first run; Daytona setup remains in the docs.</Text>
    </Box>
  );
}

function Help() {
  return (
    <Box flexDirection="column">
      <Header title="agent-paste-evals" />
      <Text>
        run --config apps/evals/config.example.yaml [--harness id] [--harnesses a,b] [--model id] [--models a,b]
        [--dry-run] [--fresh] [--no-judge] [--output dir]
      </Text>
      <Text>report &lt;result-dir&gt; [--refresh]</Text>
      <Text>models refresh [--output models.json]</Text>
      <Text>env copy [--source apps/evals/.env.local] [--target apps/evals/.env.local] [--dry-run]</Text>
      <Text>snapshot create --config apps/evals/config.example.yaml [--dry-run]</Text>
    </Box>
  );
}

function Header({ title }: { title: string }) {
  return (
    <Box borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold>{title}</Text>
    </Box>
  );
}

function processEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function EventLine({ event }: { event: RunEvent }) {
  const content = `${event.runId ? `[${event.runId}] ` : ""}${event.message}`;
  const color = colorFor(event.level);
  return color ? <Text color={color}>{content}</Text> : <Text>{content}</Text>;
}

function summarize(results: RunResult[]) {
  return {
    total: results.length,
    pass: results.filter((result) => result.status === "passed").length,
    warn: results.filter((result) => result.status === "warning").length,
    fail: results.filter((result) => result.status === "failed").length,
    skip: results.filter((result) => result.status === "skipped").length,
  };
}

function colorFor(level: RunEvent["level"]) {
  if (level === "success") {
    return "green";
  }
  if (level === "warn") {
    return "yellow";
  }
  if (level === "error") {
    return "red";
  }
  return undefined;
}
