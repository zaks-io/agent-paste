export type SandboxProcessApi = {
  createSession(sessionId: string): Promise<void>;
  executeSessionCommand(
    sessionId: string,
    request: { command: string; runAsync: boolean },
  ): Promise<{ cmdId?: string; cmd_id?: string }>;
  getSessionCommandLogs(
    sessionId: string,
    commandId: string,
    onStdout?: (chunk: string) => void,
    onStderr?: (chunk: string) => void,
  ): Promise<undefined | { output?: string; stdout?: string; stderr?: string }>;
  sendSessionCommandInput(sessionId: string, commandId: string, data: string): Promise<void>;
  exec?(
    command: string,
    cwd?: string,
    env?: Record<string, string>,
    timeout?: number,
  ): Promise<{ exitCode?: number; result?: string }>;
  executeCommand?(
    command: string,
    cwd?: string,
    env?: Record<string, string>,
    timeout?: number,
  ): Promise<{ exitCode?: number; result?: string }>;
};

export type ProcessSandboxLike = {
  process: SandboxProcessApi;
  setLabels?(labels: Record<string, string>): Promise<Record<string, string> | undefined>;
  stop?(timeout?: number, force?: boolean): Promise<void>;
};
