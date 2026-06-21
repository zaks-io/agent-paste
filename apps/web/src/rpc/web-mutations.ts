import { createServerFn } from "@tanstack/react-start";

export const createKeyFn = createServerFn({ method: "POST" })
  .inputValidator((input: { name: string }) => input)
  .handler(async ({ data }) => {
    const { createKey } = await import("../server/web-mutations");
    return createKey(data);
  });

export const revokeKeyFn = createServerFn({ method: "POST" })
  .inputValidator((input: { apiKeyId: string }) => input)
  .handler(async ({ data }) => {
    const { revokeKey } = await import("../server/web-mutations");
    return revokeKey(data);
  });

export const createAccessLinkFn = createServerFn({ method: "POST" })
  .inputValidator((input: { artifactId: string; type: "share" | "revision"; revision_id?: string }) => input)
  .handler(async ({ data }) => {
    const { createAccessLink } = await import("../server/web-mutations");
    return createAccessLink(data);
  });

export const mintAccessLinkFn = createServerFn({ method: "POST" })
  .inputValidator((input: { accessLinkId: string }) => input)
  .handler(async ({ data }) => {
    const { mintAccessLink } = await import("../server/web-mutations");
    return mintAccessLink(data);
  });

export const revokeAccessLinkFn = createServerFn({ method: "POST" })
  .inputValidator((input: { accessLinkId: string }) => input)
  .handler(async ({ data }) => {
    const { revokeAccessLink } = await import("../server/web-mutations");
    return revokeAccessLink(data);
  });

export const setAccessLinkLockdownFn = createServerFn({ method: "POST" })
  .inputValidator((input: { artifactId: string; locked: boolean }) => input)
  .handler(async ({ data }) => {
    const { setAccessLinkLockdown } = await import("../server/web-mutations");
    return setAccessLinkLockdown(data);
  });

export const saveSettingsFn = createServerFn({ method: "POST" })
  .inputValidator((input: { workspace_name: string; auto_deletion_days: number }) => input)
  .handler(async ({ data }) => {
    const { saveSettings } = await import("../server/web-mutations");
    return saveSettings(data);
  });

export const setLockdownFn = createServerFn({ method: "POST" })
  .inputValidator((input: { scope: string; target_id: string; reason_code: string }) => input)
  .handler(async ({ data }) => {
    const { setLockdown } = await import("../server/web-mutations");
    return setLockdown(data);
  });

export const liftLockdownFn = createServerFn({ method: "POST" })
  .inputValidator((input: { scope: string; target_id?: string }) => input)
  .handler(async ({ data }) => {
    const { liftLockdown } = await import("../server/web-mutations");
    return liftLockdown(data);
  });

export const startCheckoutFn = createServerFn({ method: "POST" })
  .inputValidator((input: { interval: "month" | "year" }) => input)
  .handler(async ({ data }) => {
    const { startCheckout } = await import("../server/web-mutations");
    return startCheckout(data);
  });

export const openPortalFn = createServerFn({ method: "POST" }).handler(async () => {
  const { openPortal } = await import("../server/web-mutations");
  return openPortal();
});

export const claimEphemeralFn = createServerFn({ method: "POST" })
  .inputValidator((input: { claim_token: string; turnstile_token: string }) => input)
  .handler(async ({ data }) => {
    const { claimEphemeral } = await import("../server/web-mutations");
    return claimEphemeral(data);
  });

export const completeAgentAuthClaimFn = createServerFn({ method: "POST" })
  .inputValidator((input: { claim_token?: string; claim_attempt_token?: string; user_code: string }) => input)
  .handler(async ({ data }) => {
    const { completeAgentAuthClaim } = await import("../server/web-mutations");
    return completeAgentAuthClaim(data);
  });
