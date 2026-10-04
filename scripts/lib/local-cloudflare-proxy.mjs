import { createServer, request } from "node:http";
import { listenHttpPort } from "./smoke-port.mjs";

// Wrangler's multi-config mode exposes one public listener. Route each app port
// through service bindings in that runtime so queues and Durable Objects share it.
export async function startLocalCloudflareProxies(ports, gatewayPort) {
  const servers = [];
  try {
    for (const [app, port] of Object.entries(ports)) {
      const server = createServer((incoming, outgoing) => {
        const upstream = request(
          {
            hostname: "127.0.0.1",
            port: gatewayPort,
            method: incoming.method,
            path: incoming.url,
            headers: { ...incoming.headers, "x-local-worker": app, "cf-connecting-ip": incoming.socket.remoteAddress },
          },
          (response) => {
            outgoing.writeHead(response.statusCode, response.headers);
            response.pipe(outgoing);
          },
        );
        upstream.on("error", () => {
          if (outgoing.headersSent) {
            outgoing.destroy();
            return;
          }
          outgoing.writeHead(502, { "content-type": "text/plain" });
          outgoing.end("Local Cloudflare is starting or unavailable.");
        });
        incoming.on("aborted", () => upstream.destroy());
        incoming.pipe(upstream);
      });
      await listenHttpPort(server, port, { envVar: "local Cloudflare app ports", label: app });
      servers.push(server);
    }
    return servers;
  } catch (error) {
    for (const server of servers) server.close();
    throw error;
  }
}
