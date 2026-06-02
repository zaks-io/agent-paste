import { handleWriteAllowanceRequest, resetWriteAllowanceAlarm, type WriteAllowanceStorage } from "./client.js";

type MemoryStorage = {
  value?: { day: string; consumed: number } | undefined;
  alarmAt?: number | null;
};

const storages = new Map<string, MemoryStorage>();

function storageFor(workspaceId: string): MemoryStorage {
  let storage = storages.get(workspaceId);
  if (!storage) {
    storage = {};
    storages.set(workspaceId, storage);
  }
  return storage;
}

function durableStorage(workspaceId: string): WriteAllowanceStorage {
  const memory = storageFor(workspaceId);
  return {
    async get(key) {
      if (key !== "daily_new_artifacts") {
        return undefined;
      }
      return memory.value;
    },
    async put(key, value) {
      if (key === "daily_new_artifacts") {
        memory.value = value;
      }
    },
    async delete(key) {
      if (key === "daily_new_artifacts") {
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

export function createMemoryWriteAllowanceNamespace() {
  return {
    idFromName(name: string) {
      return name;
    },
    get(id: string) {
      return {
        fetch: (request: Request) => handleWriteAllowanceRequest(request, durableStorage(id)),
      };
    },
  };
}

export function resetMemoryWriteAllowanceCounters(): void {
  storages.clear();
}

export async function runMemoryWriteAllowanceAlarm(workspaceId: string): Promise<void> {
  await resetWriteAllowanceAlarm(durableStorage(workspaceId));
}
