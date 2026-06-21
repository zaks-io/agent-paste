export type CommandName = "run" | "report" | "models" | "snapshot" | "env" | "help";

export type CliArgs =
  | {
      command: "run";
      configPath: string;
      dryRun: boolean;
      fresh: boolean;
      outputDir?: string | undefined;
      noJudge: boolean;
      modelIds: string[];
      harnessIds: string[];
    }
  | { command: "report"; resultDir: string; refresh: boolean }
  | { command: "models"; outputPath?: string | undefined }
  | { command: "snapshot"; configPath: string; dryRun: boolean }
  | { command: "env"; sourcePath?: string | undefined; targetPath?: string | undefined; dryRun: boolean }
  | { command: "help" };

export type RunStatus = "queued" | "running" | "passed" | "failed" | "warning" | "skipped";

export type RunEvent = {
  at: string;
  runId?: string;
  level: "info" | "warn" | "error" | "success";
  message: string;
};

export type EvalRun = {
  id: string;
  fingerprint: string;
  suiteId: string;
  repeat: number;
  harness: HarnessConfig;
  model: ModelConfig;
  prompt: string;
  claimCode?: string | undefined;
  outputDir: string;
};

export type RunResult = {
  run_id: string;
  run_fingerprint?: string | undefined;
  verifier_fingerprint?: string | undefined;
  judge_fingerprint?: string | undefined;
  suite_id: string;
  model_id: string;
  harness_id: string;
  status: RunStatus;
  started_at: string;
  finished_at: string;
  duration_ms?: number | undefined;
  deterministic_pass: boolean;
  prompt?: string | undefined;
  claim_code?: string | undefined;
  final_answer?: string | undefined;
  unlisted_url?: string | undefined;
  claim_url?: string | undefined;
  warnings: string[];
  failures: string[];
  verifier?: VerifierResult | undefined;
  judge?: JudgeResult | undefined;
  token_usage?: TokenUsage | undefined;
  cost_usd?: number | undefined;
  turn_count?: number | undefined;
  transcript_path?: string | undefined;
  events_path?: string | undefined;
  result_dir: string;
};

export type TokenUsage = {
  input?: number | undefined;
  output?: number | undefined;
  reasoning?: number | undefined;
  cache_read?: number | undefined;
  cache_write?: number | undefined;
  total?: number | undefined;
};

export type VerifierResult = {
  passed: boolean;
  status?: number | undefined;
  unlisted_url?: string | undefined;
  claim_url?: string | undefined;
  private_url?: string | undefined;
  revision_content_url?: string | undefined;
  production_url_detected: boolean;
  production_doc_url_detected: boolean;
  production_handoff_url_detected: boolean;
  production_artifact_url_detected: boolean;
  production_url_details: {
    docs: string[];
    handoff: string[];
    other: string[];
    artifact: string[];
  };
  secret_detected: boolean;
  secret_sources: string[];
  warnings: string[];
  errors: string[];
};

export type JudgeFinding = {
  kind: "doc_friction" | "prompt_friction" | "model_behavior" | "tooling" | "other";
  severity: "low" | "medium" | "high";
  evidence: string;
  wasted_turns?: number | undefined;
  estimated_wasted_tokens?: number | undefined;
  suggested_doc_target?: string | undefined;
  suggested_fix?: string | undefined;
  confidence: number;
};

export type JudgeResult = {
  score: number;
  task_success: number;
  onboarding_correctness: number;
  efficiency: number;
  doc_friction_signal: number;
  safety_public_sharing: number;
  verdict: "pass" | "pass_with_warning" | "fail";
  summary: string;
  findings: JudgeFinding[];
  token_usage?: TokenUsage | undefined;
  cost_usd?: number | undefined;
  raw?: unknown;
};

export type EvalConfig = {
  version: 1;
  suite: SuiteConfig;
  environment: EnvironmentConfig;
  sandbox: SandboxConfig;
  matrix: MatrixConfig;
  timeouts: TimeoutConfig;
  retries: RetryConfig;
  verification: VerificationConfig;
  judge: JudgeConfig;
  reporting: ReportingConfig;
  cleanup: CleanupConfig;
};

export type SuiteConfig = {
  id: string;
  description?: string;
  prompt: PromptConfig;
};

export type PromptConfig = {
  source: "static";
  text: string;
  claim_code: { mode: "generate" | "fixed" | "none"; value?: string | undefined; prompt_suffix?: string | undefined };
};

export type EnvironmentConfig = {
  target: "preview" | "local";
  reject_production_urls: boolean;
  env: Record<string, string>;
};

export type SandboxConfig = {
  provider: "daytona" | "docker";
  snapshot?: string | undefined;
  image?: string | undefined;
  region?: string | undefined;
  docker: DockerSandboxConfig;
  max_concurrent_creates: number;
  max_concurrent_running: number;
  resources: { cpu: number; memory_gb: number; disk_gb: number };
  lifecycle: { auto_stop_interval_minutes: number; auto_delete_interval_minutes: number };
  network: SandboxNetworkConfig;
  fresh_paths: Record<string, string>;
  forbidden_cached_packages: string[];
};

export type SandboxNetworkConfig = {
  allow_domains: string[];
  allow_cidrs: string[];
  probe_urls: string[];
  block_all: boolean;
};

export type DockerSandboxConfig = {
  build: "missing" | "always" | "never";
  dockerfile: string;
  context: string;
  network: string;
  workdir: string;
  platform?: string | undefined;
  extra_run_args: string[];
};

export type MatrixConfig = {
  repeats_per_model: number;
  concurrency: number;
  openrouter: { max_concurrent_requests: number; requests_per_minute: number | null; tokens_per_minute: number | null };
  harnesses: HarnessConfig[];
  models: ModelConfig[];
};

export type HarnessConfig = {
  id: string;
  enabled?: boolean | undefined;
  adapter: "pi" | "claude-code" | "codex";
  command: string;
  mode: "rpc" | "stream-json" | "jsonl";
  version: string;
  profile: string;
  capabilities: Record<string, boolean>;
  config: Record<string, unknown>;
};

export type ModelConfig = {
  id: string;
  label?: string | undefined;
  provider: "openrouter";
  enabled?: boolean | undefined;
  effort_label?: string | undefined;
  harness_model_ids?: Record<string, string> | undefined;
  supported_harnesses?: string[] | undefined;
  pi?:
    | {
        thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | undefined;
        contextWindow?: number | undefined;
        maxTokens?: number | undefined;
        cost?:
          | {
              input?: number | undefined;
              output?: number | undefined;
              cacheRead?: number | undefined;
              cacheWrite?: number | undefined;
            }
          | undefined;
      }
    | undefined;
  provider_params?: Record<string, unknown> | undefined;
};

export type TimeoutConfig = {
  agent_timeout_ms: number;
  command_idle_timeout_ms: number;
  sandbox_boot_timeout_ms: number;
  verification_timeout_ms: number;
  judge_timeout_ms: number;
  max_turns: number;
};

export type RetryConfig = { infra_attempts: number; retryable_categories: string[] };

export type VerificationConfig = {
  require_unlisted_url: boolean;
  require_final_answer_url: boolean;
  require_http_status: number;
  capture_claim_url: boolean;
  redeem_claim_url: boolean;
  fetch_artifact_snapshot: boolean;
};

export type JudgeConfig = {
  enabled: boolean;
  provider: "openrouter";
  model: string;
  rubric_version: string;
  max_transcript_chars: number;
  oversized_transcript: "fail" | "truncate";
  structured_output: boolean;
  weights: Record<string, number>;
};

export type ReportingConfig = {
  output_dir: string;
  env_file: string;
  write_jsonl_events: boolean;
  write_html_transcript: boolean;
  write_artifact_snapshot: boolean;
  write_aggregate_markdown: boolean;
};

export type CleanupConfig = { mode: "expire_only" | "keep" | "delete_if_possible" };

export type ModelMetadata = {
  id: string;
  name?: string | undefined;
  context_length?: number | undefined;
  pricing?: Record<string, string> | undefined;
  reasoning?: unknown;
  supported_parameters?: string[] | undefined;
  top_provider?: { context_length?: number | undefined; max_completion_tokens?: number | undefined } | undefined;
};
