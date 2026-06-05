import type { LocalState } from "../local-state.js";
import type { Entities } from "../ports.js";
import { localArtifactLifecycleMethods } from "./artifacts-lifecycle.js";
import { localArtifactPinMethods } from "./artifacts-pin.js";
import { localArtifactReadMethods } from "./artifacts-read.js";
import { localArtifactReparentMethods } from "./artifacts-reparent.js";
import { localArtifactUpdateMethods } from "./artifacts-update.js";

export function localArtifacts(state: LocalState): Entities["artifacts"] {
  return {
    ...localArtifactReadMethods(state),
    ...localArtifactUpdateMethods(state),
    ...localArtifactPinMethods(state),
    ...localArtifactLifecycleMethods(state),
    ...localArtifactReparentMethods(state),
  };
}
