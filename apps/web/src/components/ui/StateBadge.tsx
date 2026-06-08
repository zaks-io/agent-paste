import { Badge } from "@agent-paste/ui";
import type { EntityState } from "../../lib/revocable-entity-state";

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
