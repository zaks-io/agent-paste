import type { AppliedProvisionConfig, EphemeralProvisionConfigKv } from "./ephemeral-provision-config.js";
import { type EphemeralProvisionGateStorage, handleEphemeralProvisionGateRequest } from "./ephemeral-provision-gate.js";
import type { StoredGateState } from "./ephemeral-provision-gate-state.js";

type MemoryStorage = {
  gate?: StoredGateState | undefined;
  config?: AppliedProvisionConfig | undefined;
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
    async getGate() {
      return memory.gate;
    },
    async getConfig() {
      return memory.config;
    },
    async putGate(value) {
      memory.gate = value;
    },
    async putConfig(value) {
      memory.config = value;
    },
    async deleteGate() {
      memory.gate = undefined;
    },
    async setAlarm(scheduledTime) {
      memory.alarmAt = scheduledTime;
    },
    async deleteAlarm() {
      memory.alarmAt = null;
    },
  };
}

export function createMemoryEphemeralProvisionGateNamespace(configKv?: EphemeralProvisionConfigKv) {
  return {
    idFromName(name: string) {
      return name;
    },
    get(id: string) {
      return {
        fetch: (request: Request) => handleEphemeralProvisionGateRequest(request, durableStorage(id), configKv),
      };
    },
  };
}

export function resetMemoryEphemeralProvisionGate(): void {
  storages.clear();
}
