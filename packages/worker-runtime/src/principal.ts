import type { AuthRequirement, ErrorCode, Scope } from "@agent-paste/contracts";

export type ScopedActor = {
  type: string;
  id: string;
  workspace_id?: string;
  scopes?: readonly Scope[];
};

export type ApiKeyPrincipal<Actor extends ScopedActor = ScopedActor> = {
  kind: "api_key";
  actor: Actor;
};

export type WorkOsAccessTokenPrincipal<Identity = unknown, Actor extends ScopedActor = ScopedActor> = {
  kind: "workos_access_token";
  identity: Identity;
  actor?: Actor;
};

export type OperatorPrincipal = {
  kind: "operator";
  actor: { type: "platform"; id: string };
};

export type SignedAgentViewTokenPrincipal<Payload = unknown> = {
  kind: "signed_agent_view_token";
  payload: Payload;
};

export type SignedUploadUrlPrincipal<Payload = unknown> = {
  kind: "signed_upload_url";
  payload: Payload;
};

export type SignedContentTokenPrincipal<Payload = unknown> = {
  kind: "signed_content_token";
  payload: Payload;
};

export type StripeWebhookSignaturePrincipal = {
  kind: "stripe_webhook_signature";
};

export type AnonymousPrincipal = {
  kind: "none";
};

export type Principal =
  | ApiKeyPrincipal
  | WorkOsAccessTokenPrincipal
  | OperatorPrincipal
  | SignedAgentViewTokenPrincipal
  | SignedUploadUrlPrincipal
  | SignedContentTokenPrincipal
  | StripeWebhookSignaturePrincipal
  | AnonymousPrincipal;

export type PrincipalFor<Auth extends AuthRequirement> = Auth extends "api_key"
  ? ApiKeyPrincipal
  : Auth extends "api_key_or_mcp_oauth"
    ? ApiKeyPrincipal | WorkOsAccessTokenPrincipal
    : Auth extends "mcp_oauth"
      ? WorkOsAccessTokenPrincipal
      : Auth extends "workos_access_token"
        ? WorkOsAccessTokenPrincipal
        : Auth extends "operator"
          ? OperatorPrincipal
          : Auth extends "signed_agent_view_token"
            ? SignedAgentViewTokenPrincipal
            : Auth extends "signed_upload_url"
              ? SignedUploadUrlPrincipal
              : Auth extends "signed_content_token"
                ? SignedContentTokenPrincipal
                : Auth extends "stripe_webhook_signature"
                  ? StripeWebhookSignaturePrincipal
                  : Auth extends "none"
                    ? AnonymousPrincipal
                    : Principal;

export type AuthSuccess<P extends Principal = Principal> = { ok: true; principal: P };
export type AuthFailure = { ok: false; code: ErrorCode; message?: string };
export type AuthResult<P extends Principal = Principal> = AuthSuccess<P> | AuthFailure;
