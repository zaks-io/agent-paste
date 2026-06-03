import type { AuthRequirement, ErrorCode, RouteContract } from "@agent-paste/contracts";
import type { Context } from "hono";
import { type ErrorResponseOptions, errorResponse } from "./errors.js";

/** Auth failures any Worker resolver for this requirement may return through the registrar. */
const AUTH_FAILURE_CODES: Record<AuthRequirement, readonly ErrorCode[]> = {
  none: [],
  api_key: ["not_authenticated", "invalid_auth"],
  api_key_or_mcp_oauth: ["not_authenticated", "invalid_auth", "forbidden", "database_unavailable"],
  mcp_oauth: ["not_authenticated", "forbidden", "database_unavailable"],
  workos_access_token: ["not_authenticated", "forbidden", "database_unavailable"],
  operator: ["not_found"],
  signed_agent_view_token: ["not_found"],
  signed_upload_url: ["not_found", "not_authenticated"],
  signed_content_token: ["not_found"],
};

export class ContractErrorViolation extends Error {
  readonly name = "ContractErrorViolation";

  constructor(
    readonly contractId: string,
    readonly code: ErrorCode,
  ) {
    super(`Route ${contractId} emitted undeclared error code: ${code}`);
  }
}

export function isDeclaredContractError(contract: RouteContract, code: ErrorCode): boolean {
  return contract.errors.includes(code);
}

let contractErrorEnforcementOverride: boolean | undefined;

/** Test-only hook to prove production vs enforcement behavior. */
export function setContractErrorEnforcement(enabled: boolean | undefined): void {
  contractErrorEnforcementOverride = enabled;
}

export function shouldEnforceContractErrors(): boolean {
  if (contractErrorEnforcementOverride !== undefined) {
    return contractErrorEnforcementOverride;
  }
  return false;
}

export function assertContractError(contract: RouteContract, code: ErrorCode): void {
  if (!shouldEnforceContractErrors()) {
    return;
  }
  if (!isDeclaredContractError(contract, code)) {
    throw new ContractErrorViolation(contract.id, code);
  }
}

export function registrarGuardErrorCodes(
  contract: RouteContract,
  options: { hasDb?: boolean } = {},
): readonly ErrorCode[] {
  const codes = new Set<ErrorCode>(AUTH_FAILURE_CODES[contract.auth]);

  if (contract.idempotency === "required") {
    codes.add("invalid_idempotency_key");
    codes.add("idempotency_in_flight");
  }

  if (options.hasDb) {
    codes.add("database_unavailable");
  }

  switch (contract.rateLimit) {
    case "actor":
      codes.add("rate_limited_actor");
      codes.add("rate_limited_workspace");
      if (contract.auth !== "operator" && contract.auth !== "none") {
        codes.add("not_authenticated");
      }
      break;
    case "artifact":
      codes.add("rate_limited_artifact");
      break;
    case "ephemeral_provision":
      codes.add("ephemeral_provision_rate_limited");
      codes.add("ephemeral_provision_unavailable");
      break;
    default:
      break;
  }

  if (contract.scopes.length > 0) {
    codes.add("forbidden");
  }

  if (contract.requestSchema) {
    codes.add("invalid_request");
  }

  return [...codes];
}

export function assertRegistrarGuardErrorsDeclared(
  contract: RouteContract,
  options: { hasDb?: boolean } = {},
): void {
  const declared = new Set(contract.errors);
  for (const code of registrarGuardErrorCodes(contract, options)) {
    if (!declared.has(code)) {
      throw new Error(
        `Route contract ${contract.id} omits guard error code "${code}" (declared: ${contract.errors.join(", ")})`,
      );
    }
  }
}

export function contractErrorResponse(
  context: Context,
  contract: RouteContract,
  code: ErrorCode,
  options: ErrorResponseOptions = {},
): Response {
  assertContractError(contract, code);
  return errorResponse(context, code, options);
}

export function createContractErrorResponder<Contract extends RouteContract>(
  context: Context,
  contract: Contract,
  options: Omit<ErrorResponseOptions, "message"> & {
    docsBaseUrl?: string | undefined;
    defaultHeaders?: Record<string, string> | undefined;
  } = {},
): (code: Contract["errors"][number], messageOrOptions?: string | ErrorResponseOptions) => Response {
  return (code, messageOrOptions) => {
    const responseOptions: ErrorResponseOptions =
      typeof messageOrOptions === "string"
        ? { ...options, message: messageOrOptions }
        : { ...options, ...messageOrOptions };
    return contractErrorResponse(context, contract, code, responseOptions);
  };
}
