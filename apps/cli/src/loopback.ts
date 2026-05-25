import { execFile } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type CallbackResult = {
  code: string;
  state: string;
};

export type LoopbackServer = {
  port: number;
  redirectUri: string;
  waitForCallback(): Promise<CallbackResult>;
  close(): Promise<void>;
};

// Binds a one-shot listener on an ephemeral loopback port. WorkOS accepts the
// wildcard redirect http://127.0.0.1:*/callback, so the port is chosen by the
// OS and echoed into the redirect_uri.
export async function startLoopbackServer(expectedState: string): Promise<LoopbackServer> {
  let resolveCallback: (result: CallbackResult) => void;
  let rejectCallback: (error: Error) => void;
  const callback = new Promise<CallbackResult>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });

  const server = createServer((request, response) => {
    handleRequest(request, response, expectedState, {
      resolve: (value) => resolveCallback(value),
      reject: (error) => rejectCallback(error),
    });
  });

  await listen(server);
  const port = (server.address() as AddressInfo).port;

  return {
    port,
    redirectUri: `http://127.0.0.1:${port}/callback`,
    waitForCallback: () => callback,
    close: () => close(server),
  };
}

export function openBrowser(url: string, platform: string = process.platform): void {
  const command = browserCommand(platform);
  if (!command) {
    return;
  }
  execFile(command.bin, [...command.args, url], () => {
    // Best-effort: callers print the URL when the browser cannot be opened.
  });
}

function browserCommand(platform: string): { bin: string; args: string[] } | null {
  if (platform === "darwin") {
    return { bin: "open", args: [] };
  }
  if (platform === "win32") {
    return { bin: "cmd", args: ["/c", "start", ""] };
  }
  return { bin: "xdg-open", args: [] };
}

function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  expectedState: string,
  settle: { resolve: (value: CallbackResult) => void; reject: (error: Error) => void },
): void {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== "/callback") {
    response.writeHead(404).end();
    return;
  }

  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (error) {
    respond(response, 400, failurePage(error));
    settle.reject(new Error(`Authorization failed: ${error}`));
    return;
  }
  if (!code || !state) {
    respond(response, 400, failurePage("missing_code_or_state"));
    settle.reject(new Error("Authorization callback missing code or state."));
    return;
  }
  if (state !== expectedState) {
    respond(response, 400, failurePage("state_mismatch"));
    settle.reject(new Error("Authorization state did not match. Aborting login."));
    return;
  }

  respond(response, 200, successPage());
  settle.resolve({ code, state });
}

function respond(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" }).end(body);
}

function successPage(): string {
  return page("You are signed in", "You can close this tab and return to your terminal.");
}

function failurePage(reason: string): string {
  return page("Sign-in failed", `Return to your terminal and try again. (${reason})`);
}

function page(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family:system-ui;max-width:32rem;margin:6rem auto;text-align:center"><h1>${title}</h1><p>${body}</p></body></html>`;
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}
