export type SandboxProcessApi = {
  createSession(sessionId: string): Promise<void>;
  executeSessionCommand(
    sessionId: string,
    request: { command: string; runAsync: boolean },
    // Daytona returns cmd_id; Docker returns cmdId. Harness code accepts either.
  ): Promise<{ cmdId?: string; cmd_id?: string }>;
  getSessionCommandLogs(
    sessionId: string,
    commandId: string,
    onStdout?: (chunk: string) => void,
    onStderr?: (chunk: string) => void,
  ): Promise<undefined | { output?: string; stdout?: string; stderr?: string; exitCode?: number }>;
  sendSessionCommandInput(sessionId: string, commandId: string, data: string): Promise<void>;
  // Docker exposes exec; Daytona exposes executeCommand. Callers normalize both.
  exec?(
    command: string,
    cwd?: string,
    env?: Record<string, string>,
    timeout?: number,
  ): Promise<{ exitCode?: number; result?: string; stdout?: string; stderr?: string }>;
  executeCommand?(
    command: string,
    cwd?: string,
    env?: Record<string, string>,
    timeout?: number,
  ): Promise<{ exitCode?: number; result?: string; stdout?: string; stderr?: string }>;
};

export type ProcessSandboxLike = {
  process: SandboxProcessApi;
  setLabels?(labels: Record<string, string>): Promise<Record<string, string> | undefined>;
  stop?(timeout?: number, force?: boolean): Promise<void>;
};
