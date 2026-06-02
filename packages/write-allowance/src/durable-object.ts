import { handleWriteAllowanceRequest, resetWriteAllowanceAlarm, type WriteAllowanceStorage } from "./client.js";

export class WorkspaceWriteAllowance implements DurableObject {
  constructor(
    readonly state: DurableObjectState,
    readonly env: Cloudflare.Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    return handleWriteAllowanceRequest(request, this.storageAdapter());
  }

  async alarm(): Promise<void> {
    await resetWriteAllowanceAlarm(this.storageAdapter());
  }

  private storageAdapter(): WriteAllowanceStorage {
    const storage = this.state.storage;
    return {
      get: (key) => storage.get(key),
      put: (key, value) => storage.put(key, value),
      delete: async (key) => {
        await storage.delete(key);
      },
      setAlarm: (scheduledTime) => storage.setAlarm(scheduledTime),
      deleteAlarm: () => storage.deleteAlarm(),
    };
  }
}
