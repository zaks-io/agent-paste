import {
  DAILY_NEW_ARTIFACT_ALLOWANCE_FREE,
  DAILY_NEW_ARTIFACT_ALLOWANCE_PRO,
  type WorkspacePlan,
} from "@agent-paste/config";
import type { BillingInterval } from "@agent-paste/contracts";

/**
 * Orientation-only price for a Plan. Stripe is the source of truth at checkout, so
 * these are display strings for the dashboard and landing surfaces, never a charge
 * authority. `null` for a Plan that costs nothing.
 */
export type PlanPrice = Record<BillingInterval, { amount: string; per: string }> | null;

/**
 * The human-facing definition of a Plan: how it is named, priced, and described
 * on the billing dashboard (and the landing page once it renders pricing). The
 * enforced caps live in the Usage
 * Policy (`@agent-paste/config`); this is the presentational half. The headline
 * allowance bullet is sourced from the same config constant the runtime enforces,
 * so the number is never re-typed.
 */
export type Plan = {
  id: WorkspacePlan;
  name: string;
  price: PlanPrice;
  dailyNewArtifactAllowance: number;
  features: readonly string[];
};

function allowanceLine(allowance: number): string {
  return `${allowance.toLocaleString("en")} new artifacts per day`;
}

export const PLANS: Record<WorkspacePlan, Plan> = {
  free: {
    id: "free",
    name: "Free",
    price: { month: { amount: "$0", per: "/ mo" }, year: { amount: "$0", per: "/ yr" } },
    dailyNewArtifactAllowance: DAILY_NEW_ARTIFACT_ALLOWANCE_FREE,
    features: [
      allowanceLine(DAILY_NEW_ARTIFACT_ALLOWANCE_FREE),
      "Unlimited reads, no egress cost",
      "Ephemeral + claimable artifacts",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    price: { month: { amount: "$12", per: "/ mo" }, year: { amount: "$120", per: "/ yr" } },
    dailyNewArtifactAllowance: DAILY_NEW_ARTIFACT_ALLOWANCE_PRO,
    features: [
      allowanceLine(DAILY_NEW_ARTIFACT_ALLOWANCE_PRO),
      "Priority artifact retention",
      "Customer Portal self-serve billing",
    ],
  },
};
