import { writeFile } from "node:fs/promises";
import { modelEnabled, modelRunKey } from "./model-config";
import type { EvalConfig, ModelMetadata } from "./types";

const MODELS_URL = "https://openrouter.ai/api/v1/models";
const ZDR_ENDPOINTS_URL = "https://openrouter.ai/api/v1/endpoints/zdr";
const OPENROUTER_METADATA_TIMEOUT_MS = 30_000;

export type OpenRouterZdrEndpoint = {
  model_id: string;
  provider_name?: string | undefined;
  tag?: string | undefined;
  status?: number | undefined;
};

export async function fetchOpenRouterModels(apiKey?: string): Promise<ModelMetadata[]> {
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }
  const response = await fetch(MODELS_URL, { headers, signal: AbortSignal.timeout(OPENROUTER_METADATA_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`OpenRouter model list failed: ${response.status} ${response.statusText}`);
  }
  const body = (await response.json()) as { data?: ModelMetadata[] };
  return body.data ?? [];
}

export async function fetchOpenRouterZdrEndpoints(apiKey?: string): Promise<OpenRouterZdrEndpoint[]> {
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }
  const response = await fetch(ZDR_ENDPOINTS_URL, {
    headers,
    signal: AbortSignal.timeout(OPENROUTER_METADATA_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`OpenRouter ZDR endpoint list failed: ${response.status} ${response.statusText}`);
  }
  return parseOpenRouterZdrEndpoints(await response.json());
}

export function validateConfiguredModels(config: EvalConfig, models: ModelMetadata[]): string[] {
  const warnings: string[] = [];
  const byId = new Map(models.map((model) => [model.id, model]));
  for (const model of config.matrix.models) {
    if (!modelEnabled(model)) {
      continue;
    }
    const metadata = byId.get(model.id);
    if (!metadata) {
      throw new Error(`OpenRouter model not found: ${model.id}`);
    }
    for (const key of Object.keys(model.provider_params ?? {})) {
      if (key === "provider") {
        continue;
      }
      if (metadata.supported_parameters && !metadata.supported_parameters.includes(key)) {
        warnings.push(`${model.id} does not list provider param "${key}" in supported_parameters`);
      }
    }
  }
  return warnings;
}

export function validateConfiguredModelZdr(config: EvalConfig, endpoints: OpenRouterZdrEndpoint[]): string[] {
  const warnings: string[] = [];
  const byModel = new Map<string, OpenRouterZdrEndpoint[]>();
  for (const endpoint of endpoints) {
    const existing = byModel.get(endpoint.model_id) ?? [];
    existing.push(endpoint);
    byModel.set(endpoint.model_id, existing);
  }

  const missing = config.matrix.models
    .filter((model) => modelEnabled(model) && requiresZdr(model.provider_params))
    .filter((model) => !byModel.has(model.id));
  if (missing.length > 0) {
    throw new Error(`openrouter_zdr_model_not_available:${missing.map(modelRunKey).join(",")}`);
  }

  for (const model of config.matrix.models.filter((item) => modelEnabled(item) && requiresZdr(item.provider_params))) {
    const degraded = (byModel.get(model.id) ?? []).filter(
      (endpoint) => endpoint.status !== undefined && endpoint.status < 0,
    );
    if (degraded.length > 0) {
      warnings.push(
        `${modelRunKey(model)} has degraded ZDR endpoints: ${degraded
          .map((endpoint) => `${endpoint.provider_name ?? endpoint.tag ?? "unknown"} status=${endpoint.status}`)
          .join(", ")}`,
      );
    }
  }

  return warnings;
}

export async function writeModelSnapshot(path: string, models: ModelMetadata[]): Promise<void> {
  await writeFile(path, `${JSON.stringify({ fetched_at: new Date().toISOString(), data: models }, null, 2)}\n`);
}

export function parseOpenRouterZdrEndpoints(body: unknown): OpenRouterZdrEndpoint[] {
  const data = Array.isArray(body)
    ? body
    : isRecord(body) && Array.isArray(body.data)
      ? body.data
      : isRecord(body) && Array.isArray(body.endpoints)
        ? body.endpoints
        : [];
  return data
    .map((entry) => (isRecord(entry) ? endpointFromRecord(entry) : undefined))
    .filter((endpoint): endpoint is OpenRouterZdrEndpoint => Boolean(endpoint));
}

function endpointFromRecord(entry: Record<string, unknown>): OpenRouterZdrEndpoint | undefined {
  const modelId =
    typeof entry.model_id === "string" ? entry.model_id : typeof entry.id === "string" ? entry.id : undefined;
  if (!modelId) {
    return undefined;
  }
  return {
    model_id: modelId,
    ...(typeof entry.provider_name === "string" ? { provider_name: entry.provider_name } : {}),
    ...(typeof entry.tag === "string" ? { tag: entry.tag } : {}),
    ...(typeof entry.status === "number" ? { status: entry.status } : {}),
  };
}

function requiresZdr(providerParams: Record<string, unknown> | undefined): boolean {
  const provider = providerParams?.provider;
  return isRecord(provider) && provider.zdr === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
