import { type RequestIdVariables, requestIdMiddleware } from "@agent-paste/auth";
import { buildContentOpenApiDocument, routeContractById } from "@agent-paste/contracts";
import { resolveContentTokenSigner } from "@agent-paste/rotation";
import { CONTENT_SECURITY_HEADERS } from "@agent-paste/storage";
import { type ContentTokenPayload, mintContentToken } from "@agent-paste/tokens/content";
import {
  BASELINE_SECURITY_HEADERS,
  type BoundRespondersVariables,
  boundRespondersMiddleware,
  createRegistrar,
  getBoundResponders,
  type SignedContentTokenPrincipal,
  securityHeadersMiddleware,
  sentryOptions,
} from "@agent-paste/worker-runtime";
import * as Sentry from "@sentry/cloudflare";
import { Hono } from "hono";
import type { AppContext, Env } from "./env.js";
import {
  contentPath,
  contentTokenFromRequest,
  isAllowedPath,
  isDenylisted,
  serveSignedBundle,
  serveSignedObject,
} from "./serve-object.js";

export type { Env, R2Bucket, R2ObjectBody } from "./env.js";
export type { ContentTokenPayload };
export { mintContentToken as signContentToken };

const contractById = routeContractById;
const securityHeaders = { ...BASELINE_SECURITY_HEADERS, ...CONTENT_SECURITY_HEADERS };
const boundResponderConfig = {
  docsBaseUrl: (context: AppContext) => context.env.DOCS_BASE_URL,
  defaultErrorHeaders: () => securityHeaders,
} as const;
const app = new Hono<{ Bindings: Env; Variables: RequestIdVariables & BoundRespondersVariables }>();
export const mountedRouteIds = new Set<string>();
export const nonContractRoutePaths = ["/healthz", "/openapi.json"] as const;

app.use("*", securityHeadersMiddleware());
app.use("*", requestIdMiddleware());
app.use("*", boundRespondersMiddleware(boundResponderConfig));
app.get("/healthz", (c) => c.text("ok"));
app.get("/openapi.json", (context) =>
  context.json(
    buildContentOpenApiDocument({ serverUrl: context.env.CONTENT_BASE_URL ?? new URL(context.req.raw.url).origin }),
  ),
);
const contentRegistrar = createRegistrar({
  app,
  auth: {
    async signed_content_token(context) {
      const appContext = context as AppContext;
      const path = contentPath(appContext);
      const env = context.env as Env;
      const token = contentTokenFromRequest(appContext);
      const signer = resolveContentTokenSigner(env);
      const payload = signer ? await signer.verify(token) : null;
      if (!payload || !isAllowedPath(path, payload)) {
        return { ok: false, code: "not_found" };
      }
      if (await isDenylisted(context.env as Env, payload)) {
        return { ok: false, code: "not_found" };
      }
      return { ok: true, principal: { kind: "signed_content_token", payload } };
    },
  },
  rateLimitBindings: (context) => ({ artifact: (context.env as Env).ARTIFACT_RATE_LIMIT }),
  docsBaseUrl: boundResponderConfig.docsBaseUrl,
  defaultErrorHeaders: boundResponderConfig.defaultErrorHeaders,
  onMount: (contract) => {
    mountedRouteIds.add(contract.id);
  },
});
contentRegistrar.mount(contractById("content.get"), async (context, principal) =>
  serveSignedObject(
    context as AppContext,
    (principal as SignedContentTokenPrincipal<ContentTokenPayload>).payload,
    contentPath(context as AppContext),
  ),
);
contentRegistrar.mount(contractById("content.head"), async (context, principal) =>
  serveSignedObject(
    context as AppContext,
    (principal as SignedContentTokenPrincipal<ContentTokenPayload>).payload,
    contentPath(context as AppContext),
  ),
);
contentRegistrar.mount(contractById("content.bundle"), async (context, principal) =>
  serveSignedBundle(context as AppContext, (principal as SignedContentTokenPrincipal<ContentTokenPayload>).payload),
);
contentRegistrar.mount(contractById("content.bundleHead"), async (context, principal) =>
  serveSignedBundle(context as AppContext, (principal as SignedContentTokenPrincipal<ContentTokenPayload>).payload),
);
app.notFound((context) => getBoundResponders(context).respondError("not_found"));
app.onError((error, context) => {
  console.error("Unhandled content error:", error);
  return getBoundResponders(context).respondError("internal_error");
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
