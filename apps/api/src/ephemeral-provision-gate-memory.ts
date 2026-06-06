import { type EphemeralProvisionGateStorage, handleEphemeralProvisionGateRequest } from "./ephemeral-provision-gate.js";
import type { StoredGateState } from "./ephemeral-provision-gate-state.js";

type MemoryStorage = {
  value?: StoredGateState | undefined;
  alarmAt?: number | null;
};

const storages = new Map<string, MemoryStorage>();

function storageFor(name: string): MemoryStorage {
  let storage = storages.get(name);
  if (!storage) {
    storage = {};
    storages.set(name, storage);
  }
  return storage;
}

function durableStorage(name: string): EphemeralProvisionGateStorage {
  const memory = storageFor(name);
  return {
    async get(key) {
      return key === "ephemeral_provision_gate" ? memory.value : undefined;
    },
    async put(key, value) {
      if (key === "ephemeral_provision_gate") {
        memory.value = value;
      }
    },
    async delete(key) {
      if (key === "ephemeral_provision_gate") {
        memory.value = undefined;
      }
    },
    async setAlarm(scheduledTime) {
      memory.alarmAt = scheduledTime;
    },
    async deleteAlarm() {
      memory.alarmAt = null;
    },
  };
}

export function createMemoryEphemeralProvisionGateNamespace() {
  return {
    idFromName(name: string) {
      return name;
    },
    get(id: string) {
      return {
        fetch: (request: Request) => handleEphemeralProvisionGateRequest(request, durableStorage(id)),
      };
    },
  };
}

export function resetMemoryEphemeralProvisionGate(): void {
  storages.clear();
}
