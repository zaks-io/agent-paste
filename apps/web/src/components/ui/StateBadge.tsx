import type { EntityState } from "../../lib/revocable-entity-state";
import { Badge } from "./Badge";

type Props = {
  state: EntityState;
};

export function StateBadge({ state }: Props) {
  return (
    <Badge tone={state.tone} dot>
      {state.label}
    </Badge>
  );
}
