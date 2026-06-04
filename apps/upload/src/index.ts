import { type RequestIdVariables, requestIdMiddleware } from "@agent-paste/auth";
import { buildUploadOpenApiDocument, routeContractById } from "@agent-paste/contracts";
import { type Repository, repositoryErrorToAppError } from "@agent-paste/db";
import type { SignedUploadPayload } from "@agent-paste/tokens/upload-url";
import {
  type BoundRespondersVariables,
  boundRespondersMiddleware,
  createApiKeyOrMcpOAuthResolver,
  createAuthenticateApiKey,
  createRegistrar,
  getBoundResponders,
  type SignedUploadUrlPrincipal,
  sentryOptions,
} from "@agent-paste/worker-runtime";
import * as Sentry from "@sentry/cloudflare";
import { Hono } from "hono";
import { createUploadSession } from "./create-session.js";
import type { AppContext, Env } from "./env.js";
import { finalizeUploadSession } from "./finalize.js";
import { putUploadFile, uploadFilePath, verifyUploadToken } from "./put.js";
import { postgresRuntime, uploadDatabase, uploadReplay } from "./upload-db.js";

export type { AuthService, Env, UploadActor, UploadFileInput, UploadSessionRecord } from "./env.js";

const contractById = routeContractById;

const authenticateApiKey = createAuthenticateApiKey({
  namespace: "upload-api-key-auth-v2",
  resolvePostgresRuntime: postgresRuntime,
});

const boundResponderConfig = {
  docsBaseUrl: (context: { env: Env }) => context.env.DOCS_BASE_URL,
} as const;

const app = new Hono<{ Bindings: Env; Variables: RequestIdVariables & BoundRespondersVariables }>();
export const mountedRouteIds = new Set<string>();
export const nonContractRoutePaths = ["/healthz", "/openapi.json"] as const;

app.use("*", requestIdMiddleware());
app.use("*", boundRespondersMiddleware(boundResponderConfig));
app.get("/healthz", (c) => c.text("ok"));
app.get("/openapi.json", (context) =>
  context.json(buildUploadOpenApiDocument({ serverUrl: context.env.UPLOAD_BASE_URL })),
);
const uploadDbRegistrar = createRegistrar<Repository>({
  app,
  auth: {
    async api_key(context) {
      const actor = await authenticateApiKey(context.req.raw, context.env as Env);
      return actor ? { ok: true, principal: { kind: "api_key", actor } } : { ok: false, code: "not_authenticated" };
    },
    api_key_or_mcp_oauth: createApiKeyOrMcpOAuthResolver({
      authenticateApiKey,
      resolveDatabase: uploadDatabase,
    }),
  },
  db: (context) => uploadDatabase(context.env as Env),
  rateLimitBindings: (context) => ({
    actor: (context.env as Env).ACTOR_RATE_LIMIT,
    workspace: (context.env as Env).WORKSPACE_BURST_CAP,
  }),
  docsBaseUrl: boundResponderConfig.docsBaseUrl,
  replay: uploadReplay,
  onMount: (contract) => {
    mountedRouteIds.add(contract.id);
  },
});
const uploadNoDbRegistrar = createRegistrar({
  app,
  auth: {
    async signed_upload_url(context) {
      const payload = await verifyUploadToken(
        new URL(context.req.raw.url).searchParams.get("token"),
        context.env as Env,
      );
      const sessionId = context.req.param("upload_session_id");
      const path = uploadFilePath(context as AppContext);
      if (!payload || payload.sid !== sessionId || payload.path !== path) {
        return { ok: false, code: "not_authenticated" };
      }
      return { ok: true, principal: { kind: "signed_upload_url", payload } };
    },
  },
  docsBaseUrl: boundResponderConfig.docsBaseUrl,
  onMount: (contract) => {
    mountedRouteIds.add(contract.id);
  },
});
uploadDbRegistrar.mount(contractById("uploadSessions.create"), async (context, principal, db, guard) =>
  createUploadSession(context as AppContext, principal, db, guard),
);
uploadNoDbRegistrar.mount(contractById("uploadSessions.putFile"), async (context, principal) =>
  putUploadFile(context as AppContext, principal as SignedUploadUrlPrincipal<SignedUploadPayload>),
);
uploadDbRegistrar.mount(contractById("uploadSessions.finalize"), async (context, principal, db, guard) =>
  finalizeUploadSession(context as AppContext, principal, db, guard),
);
app.notFound((context) => getBoundResponders(context).respondError("not_found"));
app.onError((error, context) => {
  const { respondError } = getBoundResponders(context);
  const repositoryCode = repositoryErrorToAppError(error);
  if (repositoryCode) {
    return respondError(repositoryCode);
  }
  console.error("Unhandled upload error:", error);
  return respondError("internal_error");
});

const worker = {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};

export default Sentry.withSentry((env: Env) => sentryOptions(env), worker);

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  return await app.fetch(request, env);
}
