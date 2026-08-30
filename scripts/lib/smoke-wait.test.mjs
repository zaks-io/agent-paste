import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { waitForStatus } from "./smoke-wait.mjs";

describe("waitForStatus", () => {
  it("accepts the expected status from the original URL", async () => {
    const server = await startStatusServer();
    try {
      await expect(waitForStatus(`${server.baseUrl}/gone`, 404, "deleted", fastPolling)).resolves.toBeUndefined();
    } finally {
      await server.close();
    }
  });

  it("rejects a redirect whose destination has the expected status", async () => {
    const server = await startStatusServer();
    try {
      await expect(waitForStatus(`${server.baseUrl}/redirect`, 404, "deleted", fastPolling)).rejects.toThrow(
        /deleted returned 302, expected 404/,
      );
    } finally {
      await server.close();
    }
  });
});

const fastPolling = { timeoutMs: 20, intervalMs: 1 };

function startStatusServer() {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      if (request.url === "/redirect") {
        response.writeHead(302, { location: "/gone" });
        response.end();
        return;
      }
      response.writeHead(404);
      response.end();
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((closeResolve) => server.close(closeResolve)),
      });
    });
  });
}
