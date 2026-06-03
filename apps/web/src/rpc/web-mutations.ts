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

export const claimEphemeralFn = createServerFn({ method: "POST" })
  .inputValidator((input: { claim_token: string; turnstile_token: string }) => input)
  .handler(async ({ data }) => {
    const { claimEphemeral } = await import("../server/web-mutations");
    return claimEphemeral(data);
  });
