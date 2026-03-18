import net from "node:net";

const LISTEN_HOST = process.env.WSL_PROXY_BRIDGE_HOST || "0.0.0.0";
const LISTEN_PORT = Number.parseInt(process.env.WSL_PROXY_BRIDGE_PORT || "11080", 10);
const TARGET_HOST = process.env.WSL_PROXY_TARGET_HOST || "127.0.0.1";
const TARGET_PORT = Number.parseInt(process.env.WSL_PROXY_TARGET_PORT || "10808", 10);

const server = net.createServer((clientSocket) => {
  const upstreamSocket = net.connect(TARGET_PORT, TARGET_HOST);

  clientSocket.on("error", () => upstreamSocket.destroy());
  upstreamSocket.on("error", () => clientSocket.destroy());

  clientSocket.pipe(upstreamSocket);
  upstreamSocket.pipe(clientSocket);
});

server.on("error", (error) => {
  console.error(`[wsl-proxy-bridge] ${error.message}`);
  process.exit(1);
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(
    `[wsl-proxy-bridge] listening on ${LISTEN_HOST}:${LISTEN_PORT} -> ${TARGET_HOST}:${TARGET_PORT}`,
  );
});
