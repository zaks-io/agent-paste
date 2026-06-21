import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { EvalConfig } from "./types";

const stringRecord = z.record(z.string(), z.string());
const positiveInt = z.number().int().positive();
const nonNegativeInt = z.number().int().nonnegative();

const configSchema = z.object({
  version: z.literal(1),
  suite: z.object({
    id: z.string().min(1),
    description: z.string().optional(),
    prompt: z.object({
      source: z.literal("static"),
      text: z.string().min(1),
      claim_code: z.object({
        mode: z.enum(["generate", "fixed", "none"]),
        value: z.string().optional(),
        prompt_suffix: z.string().optional(),
      }),
    }),
  }),
  environment: z.object({
    target: z.enum(["preview", "local"]),
    reject_production_urls: z.boolean().default(true),
    env: stringRecord,
  }),
  sandbox: z
    .object({
      provider: z.enum(["daytona", "docker"]),
      snapshot: z.string().min(1).optional(),
      image: z.string().min(1).optional(),
      region: z.string().optional(),
      docker: z
        .object({
          build: z.enum(["missing", "always", "never"]).default("missing"),
          dockerfile: z.string().min(1).default("apps/evals/docker/pi-runner.Dockerfile"),
          context: z.string().min(1).default("apps/evals/docker"),
          network: z.string().min(1).default("bridge"),
          workdir: z.string().min(1).default("/workspace"),
          platform: z.string().min(1).optional(),
          extra_run_args: z.array(z.string().min(1)).default([]),
        })
        .default({
          build: "missing",
          dockerfile: "apps/evals/docker/pi-runner.Dockerfile",
          context: "apps/evals/docker",
          network: "bridge",
          workdir: "/workspace",
          extra_run_args: [],
        }),
      max_concurrent_creates: positiveInt.default(3),
      max_concurrent_running: positiveInt.default(3),
      resources: z.object({ cpu: positiveInt, memory_gb: positiveInt, disk_gb: positiveInt }),
      lifecycle: z.object({
        auto_stop_interval_minutes: nonNegativeInt,
        auto_delete_interval_minutes: z.number().int(),
      }),
      network: z
        .object({
          allow_domains: z.array(z.string().min(1)).default([]),
          allow_cidrs: z.array(z.string().min(1)).default([]),
          probe_urls: z.array(z.string().url()).default([]),
          block_all: z.boolean().default(false),
        })
        .default({ allow_domains: [], allow_cidrs: [], probe_urls: [], block_all: false }),
      fresh_paths: stringRecord,
      forbidden_cached_packages: z.array(z.string()).default([]),
    })
    .superRefine((sandbox, ctx) => {
      if (sandbox.provider === "daytona" && !sandbox.snapshot) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["snapshot"],
          message: "Daytona sandbox requires sandbox.snapshot",
        });
      }
      if (sandbox.provider === "docker" && !sandbox.image) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["image"],
          message: "Docker sandbox requires sandbox.image",
        });
      }
    }),
  matrix: z.object({
    repeats_per_model: positiveInt.default(1),
    concurrency: positiveInt.default(1),
    openrouter: z.object({
      max_concurrent_requests: positiveInt.default(3),
      requests_per_minute: positiveInt.nullable().default(null),
      tokens_per_minute: positiveInt.nullable().default(null),
    }),
    harnesses: z.array(harnessSchema()).min(1),
    models: z.array(modelSchema()).min(1),
  }),
  timeouts: z.object({
    agent_timeout_ms: positiveInt,
    command_idle_timeout_ms: positiveInt,
    sandbox_boot_timeout_ms: positiveInt,
    verification_timeout_ms: positiveInt,
    judge_timeout_ms: positiveInt,
    max_turns: positiveInt,
  }),
  retries: z.object({
    infra_attempts: positiveInt.default(3),
    retryable_categories: z.array(z.string()).default([]),
  }),
  verification: z.object({
    require_unlisted_url: z.boolean().default(true),
    require_final_answer_url: z.boolean().default(true),
    require_http_status: positiveInt.default(200),
    capture_claim_url: z.boolean().default(true),
    redeem_claim_url: z.boolean().default(false),
    fetch_artifact_snapshot: z.boolean().default(true),
  }),
  judge: z.object({
    enabled: z.boolean().default(true),
    provider: z.literal("openrouter"),
    model: z.string().min(1),
    rubric_version: z.string().min(1),
    max_transcript_chars: positiveInt,
    oversized_transcript: z.enum(["fail", "truncate"]).default("fail"),
    structured_output: z.boolean().default(true),
    weights: z.record(z.string(), z.number()),
  }),
  reporting: z.object({
    output_dir: z.string().min(1),
    env_file: z.string().min(1).default(".env.local"),
    write_jsonl_events: z.boolean().default(true),
    write_html_transcript: z.boolean().default(true),
    write_artifact_snapshot: z.boolean().default(true),
    write_aggregate_markdown: z.boolean().default(true),
  }),
  cleanup: z.object({
    mode: z.enum(["expire_only", "keep", "delete_if_possible"]).default("expire_only"),
  }),
});

export async function loadConfig(path: string): Promise<EvalConfig> {
  const resolvedPath = await resolveConfigPath(path);
  const source = await readFile(resolvedPath, "utf8");
  const parsed = parseYaml(source);
  return configSchema.parse(parsed) as EvalConfig;
}

export async function resolveConfigPath(inputPath: string): Promise<string> {
  const candidates = candidatePaths(inputPath);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return inputPath;
}

function candidatePaths(inputPath: string): string[] {
  if (path.isAbsolute(inputPath)) {
    return [inputPath];
  }
  const candidates = [path.resolve(inputPath)];
  const prefix = `apps${path.sep}evals${path.sep}`;
  if (inputPath.startsWith(prefix)) {
    candidates.push(path.resolve(inputPath.slice(prefix.length)));
  } else {
    candidates.push(path.resolve("apps", "evals", inputPath));
  }
  return Array.from(new Set(candidates));
}

function harnessSchema() {
  return z.object({
    id: z.string().min(1),
    adapter: z.literal("pi"),
    command: z.string().min(1),
    mode: z.literal("rpc"),
    version: z.string().min(1),
    profile: z.string().min(1),
    capabilities: z.record(z.string(), z.boolean()),
    config: z.record(z.string(), z.unknown()).default({}),
  });
}

function modelSchema() {
  return z.object({
    id: z.string().min(1),
    label: z.string().min(1).optional(),
    provider: z.literal("openrouter"),
    enabled: z.boolean().optional(),
    effort_label: z.string().optional(),
    pi: z
      .object({
        thinking: z.enum(["off", "minimal", "low", "medium", "high", "xhigh"]).optional(),
        contextWindow: z.number().int().positive().optional(),
        maxTokens: z.number().int().positive().optional(),
        cost: z
          .object({
            input: z.number().nonnegative().optional(),
            output: z.number().nonnegative().optional(),
            cacheRead: z.number().nonnegative().optional(),
            cacheWrite: z.number().nonnegative().optional(),
          })
          .optional(),
      })
      .optional(),
    provider_params: z.record(z.string(), z.unknown()).optional(),
  });
}
