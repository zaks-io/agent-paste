import {
  Button,
  buildOptionalAnalyticsCookie,
  Card,
  CardHeader,
  type OptionalAnalyticsPreference,
  readOptionalAnalyticsCookie,
} from "@agent-paste/ui";
import { useEffect, useState } from "react";

type NavigatorWithGpc = Navigator & { globalPrivacyControl?: boolean };

type AnalyticsChoiceState = {
  browserSignal: boolean;
  disabled: boolean;
  preference: OptionalAnalyticsPreference | null;
};

const UNKNOWN_STATE: AnalyticsChoiceState = {
  browserSignal: false,
  disabled: false,
  preference: null,
};

export function PrivacyChoices() {
  const [state, setState] = useState<AnalyticsChoiceState>(UNKNOWN_STATE);

  useEffect(() => {
    setState(readAnalyticsChoiceState());
  }, []);

  function togglePreference() {
    if (state.browserSignal) {
      return;
    }
    const next: OptionalAnalyticsPreference = state.disabled ? "on" : "off";
    // biome-ignore lint/suspicious/noDocumentCookie: this first-party preference must be visible to the next SSR request.
    document.cookie = buildOptionalAnalyticsCookie(
      next,
      window.location.hostname,
      window.location.protocol === "https:",
    );
    window.location.reload();
  }

  return (
    <Card>
      <CardHeader
        title="Privacy choices"
        subtitle="Optional web analytics can be disabled without affecting auth, security, billing, audit, or artifact telemetry."
        className="mb-5"
      />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="grid gap-1">
          <p className="text-base font-medium text-foreground">Optional analytics {state.disabled ? "off" : "on"}</p>
          <p className="max-w-[60ch] text-sm leading-relaxed text-muted">{analyticsChoiceMessage(state)}</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={togglePreference}
          disabled={state.browserSignal}
          aria-pressed={state.disabled}
        >
          {state.disabled ? "Turn on" : "Turn off"}
        </Button>
      </div>
    </Card>
  );
}

function analyticsChoiceMessage(state: AnalyticsChoiceState): string {
  if (state.browserSignal) {
    return "Your browser privacy signal is active, so optional web analytics stays off.";
  }
  if (state.preference === "off") {
    return "The Cloudflare Web Analytics beacon is skipped for this browser.";
  }
  return "Cloudflare Web Analytics is cookieless and can be turned off for this browser.";
}

function readAnalyticsChoiceState(): AnalyticsChoiceState {
  if (typeof document === "undefined" || typeof navigator === "undefined") {
    return UNKNOWN_STATE;
  }
  const nav = navigator as NavigatorWithGpc;
  const browserSignal = nav.globalPrivacyControl === true || navigator.doNotTrack === "1";
  const preference = readOptionalAnalyticsCookie(document.cookie);
  return {
    browserSignal,
    disabled: browserSignal || preference === "off",
    preference,
  };
}
