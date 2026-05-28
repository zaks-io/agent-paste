import { z } from "./zod.js";

/** Suggested operator reason codes for Platform Lockdown (ADR 0040). Free-form codes remain allowed. */
export const PLATFORM_LOCKDOWN_REASON_CODES = [
  "phishing_report",
  "abuse_complaint",
  "safe_browsing",
  "malware_signal",
  "tos_violation",
  "law_enforcement",
  "other",
] as const;

export type PlatformLockdownReasonCode = (typeof PLATFORM_LOCKDOWN_REASON_CODES)[number];

export const PlatformLockdownReasonCode = z.enum(PLATFORM_LOCKDOWN_REASON_CODES);
