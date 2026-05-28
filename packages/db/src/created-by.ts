import type { ApiActor } from "./types.js";

export type CreatedByType = "api_key" | "member";

export type CreatedBy = {
  created_by_type: CreatedByType;
  created_by_id: string;
};

export function createdByFromActor(actor: ApiActor): CreatedBy {
  return {
    created_by_type: actor.type,
    created_by_id: actor.id,
  };
}

export function operationActorFromApiActor(actor: ApiActor): {
  actorType: CreatedByType;
  actorId: string;
} {
  return {
    actorType: actor.type,
    actorId: actor.id,
  };
}
