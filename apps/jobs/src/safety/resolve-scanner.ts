import { DEFAULT_SAFETY_SCANNER_ID } from "@agent-paste/contracts";
import type { Env } from "../env.js";
import { createEphemeralSafetyScanner, isEphemeralScannerId } from "./ephemeral-scanner.js";
import { createBuiltInSafetyScanner, type SafetyScanner } from "./scanner.js";

export function resolveSafetyScanner(env: Env, scannerId: string): SafetyScanner {
  if (isEphemeralScannerId(scannerId)) {
    return createEphemeralSafetyScanner(env);
  }
  if (scannerId === DEFAULT_SAFETY_SCANNER_ID) {
    return createBuiltInSafetyScanner();
  }
  return createBuiltInSafetyScanner();
}
