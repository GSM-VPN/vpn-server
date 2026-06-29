import Fastify from "fastify";
import { execFile } from "node:child_process";
import type { IncomingHttpHeaders } from "node:http";
import { promisify } from "node:util";
import WebSocket from "ws";
import { config } from "./config.js";
import { deriveWireGuardPublicKey } from "./wireguard.js";
import {
  createGatewayRequestSignature,
  verifyGatewaySignature,
} from "./auth.js";
import type {
  GatewayVpnRegisterRequest,
  GatewayVpnRegisterResponse,
  PeerStatus,
  RegisterPeerRequest,
  RegisterPeerResponse,
  ReportRequest,
  RemovePeerResponse,
  ServerSnapshot,
} from "./types.js";

const app = Fastify({ logger: true });
const execFileAsync = promisify(execFile);

if (!config.serverPrivateKey) {
  throw new Error("SERVER_PRIVATE_KEY is required");
}

const serverPublicKey = deriveWireGuardPublicKey(config.serverPrivateKey);

const peers: PeerStatus[] = [];

let gatewaySocket: WebSocket | null = null;
let gatewayWsKey: string | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let reconnectDelayMs = 1000;

function buildManagementUrl(): string {
  return `${config.gatewayUrl.replace(/\/+$/, "")}`;
}

function buildEndpoint(): string {
  return `${config.serverIp}:${config.externalUdpPort}`;
}

function computeLoadPercent(): number {
  return Math.min(100, 10 + peers.length * 5);
}

function snapshot(): ServerSnapshot {
  return {
    name: config.serverName,
    ip: config.serverIp,
    internalUdpPort: config.internalUdpPort,
    externalUdpPort: config.externalUdpPort,
    externalHttpPort: config.externalHttpPort,
    httpPort: config.httpPort,
    managementUrl: `http://${config.serverIp}:${config.externalHttpPort}`,
    endpoint: buildEndpoint(),
    online: Boolean(gatewaySocket && gatewaySocket.readyState === WebSocket.OPEN),
    loadPercent: computeLoadPercent(),
    publicKey: serverPublicKey,
    peers,
  };
}

async function runWg(args: string[]): Promise<void> {
  await execFileAsync(config.wgToolPath, args, { windowsHide: true });
}

function readHeader(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function readGatewayAuthHeaders(request: { headers: IncomingHttpHeaders }): {
  deviceId: string;
  signature: string;
  serverId: string;
  timestamp: string;
} | null {
  const deviceId = readHeader(request.headers, "x-gateway-device-id");
  const signature = readHeader(request.headers, "x-gateway-signature");
  const serverId = readHeader(request.headers, "x-gateway-server-id");
  const timestamp = readHeader(request.headers, "x-gateway-timestamp");
  if (!deviceId || !signature || !serverId || !timestamp) {
    return null;
  }

  const parsed = Number(timestamp);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  if (Math.abs(Date.now() - parsed) > 5 * 60 * 1000) {
    return null;
  }

  return { deviceId, signature, serverId, timestamp };
}

function clearGatewayHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function clearGatewayReconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function sendCurrentSnapshot(): void {
  if (!gatewaySocket || gatewaySocket.readyState !== WebSocket.OPEN) {
    return;
  }

  gatewaySocket.send(JSON.stringify(snapshot()));
}

function scheduleReconnect(): void {
  if (!gatewayWsKey || reconnectTimer) {
    return;
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connectGatewayInfoSocket();
  }, reconnectDelayMs);
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, 30000);
}

function connectGatewayInfoSocket(): void {
  if (!gatewayWsKey) {
    return;
  }

  clearGatewayReconnect();

  const socketUrl = new URL(`${buildManagementUrl()}/vpn/info`);
  socketUrl.searchParams.set("wsKey", gatewayWsKey);
  const socket = new WebSocket(socketUrl);
  gatewaySocket = socket;

  socket.on("open", () => {
    reconnectDelayMs = 1000;
    clearGatewayHeartbeat();
    sendCurrentSnapshot();
    heartbeatTimer = setInterval(() => {
      sendCurrentSnapshot();
    }, config.heartbeatIntervalMs);
  });

  socket.on("close", () => {
    clearGatewayHeartbeat();
    if (gatewaySocket === socket) {
      gatewaySocket = null;
    }
    scheduleReconnect();
  });

  socket.on("error", (error) => {
    app.log.warn({ error }, "gateway websocket error");
  });
}

async function registerWithGateway(): Promise<void> {
  const gatewayBaseUrl = config.gatewayUrl.replace(/\/+$/, "");
  const timestamp = Date.now().toString();
  const body: GatewayVpnRegisterRequest = {
    ip: config.serverIp,
    internalUdpPort: config.internalUdpPort,
    externalUdpPort: config.externalUdpPort,
    httpPort: config.httpPort,
    externalHttpPort: config.externalHttpPort,
    name: config.serverName,
  };
  const signature = createGatewayRequestSignature(config.gatewaySharedSecret, [
    timestamp,
    body.ip ?? "",
    String(body.internalUdpPort ?? 0),
    String(body.externalUdpPort ?? 0),
    String(body.httpPort ?? 0),
    String(body.externalHttpPort ?? 0),
    body.name ?? "",
  ]);

  const response = await fetch(`${gatewayBaseUrl}/vpn/register`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-gateway-timestamp": timestamp,
      "x-gateway-signature": signature,
    },
    body: JSON.stringify(body),
  });

  const data = (await response.json()) as GatewayVpnRegisterResponse;
  if (!response.ok || !data.ok) {
    throw new Error("message" in data ? data.message : "failed to register VPN server");
  }

  gatewayWsKey = data.wsKey;
  config.serverName = data.server.name;
}

async function syncGatewayRegistration(): Promise<void> {
  try {
    await registerWithGateway();
    connectGatewayInfoSocket();
  } catch (error) {
    app.log.warn({ error }, "failed to register vpn server with gateway");
    clearGatewayHeartbeat();
    clearGatewayReconnect();
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void syncGatewayRegistration();
    }, reconnectDelayMs);
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, 30000);
  }
}

app.get("/health", async (): Promise<{ ok: true; role: string; snapshot: ServerSnapshot }> => {
  return {
    ok: true,
    role: "vpn",
    snapshot: snapshot(),
  };
});

app.get("/status", async (): Promise<ServerSnapshot> => {
  return snapshot();
});

app.post<{ Body: ReportRequest }>("/report", async (request): Promise<{ ok: true; received: true; gatewayTokenPresent: boolean; snapshot: ServerSnapshot }> => {
  return {
    ok: true,
    received: true,
    gatewayTokenPresent: Boolean(request.body.gatewayToken),
    snapshot: snapshot(),
  };
});

app.post<{ Body: RegisterPeerRequest }>("/peers/register", async (request, reply): Promise<RegisterPeerResponse> => {
  const auth = readGatewayAuthHeaders(request);
  if (!auth) {
    reply.code(401);
    return { ok: false, message: "unauthorized" };
  }

  const publicKey = request.body.publicKey ?? "";
  const allowedIps = request.body.allowedIps ?? [];
  const serverId = request.body.serverId ?? "unknown";
  const deviceId = request.body.deviceId ?? auth.deviceId;

  if (serverId !== auth.serverId) {
    reply.code(401);
    return { ok: false, message: "server id mismatch" };
  }

  const gatewaySignatureOk = verifyGatewaySignature(
    config.gatewaySharedSecret,
    [auth.timestamp, auth.serverId, publicKey, deviceId],
    auth.signature
  );

  if (!gatewaySignatureOk) {
    reply.code(401);
    return { ok: false, message: "invalid gateway signature" };
  }

  if (!publicKey) {
    reply.code(400);
    return { ok: false, message: "publicKey is required" };
  }

  const peer = {
    publicKey,
    allowedIps,
    lastHandshakeAt: null,
    rxBytes: 0,
    txBytes: 0,
  };

  peers.push(peer);

  try {
    await runWg([
      "set",
      config.tunnelName,
      "peer",
      publicKey,
      "allowed-ips",
      allowedIps.join(","),
    ]);
  } catch (error) {
    app.log.warn({ error }, "failed to register peer with wg");
  }

  sendCurrentSnapshot();

  return {
    ok: true,
    message: "Peer registered",
    peer,
    vpnPublicKey: serverPublicKey,
  };
});

app.delete<{ Params: { publicKey: string } }>("/peers/:publicKey", async (request, reply): Promise<RemovePeerResponse> => {
  const auth = readGatewayAuthHeaders(request);
  if (!auth) {
    reply.code(401);
    return { ok: false, message: "unauthorized" };
  }

  const gatewaySignatureOk = verifyGatewaySignature(
    config.gatewaySharedSecret,
    [auth.timestamp, auth.serverId, request.params.publicKey, auth.deviceId],
    auth.signature
  );

  if (!gatewaySignatureOk) {
    reply.code(401);
    return { ok: false, message: "invalid gateway signature" };
  }

  const before = peers.length;
  const remaining = peers.filter((peer) => peer.publicKey !== request.params.publicKey);
  peers.splice(0, peers.length, ...remaining);

  try {
    await runWg(["set", config.tunnelName, "peer", request.params.publicKey, "remove"]);
  } catch (error) {
    app.log.warn({ error }, "failed to remove peer from wg");
  }

  sendCurrentSnapshot();

  return {
    ok: true,
    removed: before - peers.length,
  };
});

const start = async (): Promise<void> => {
  try {
    await app.listen({ port: config.httpPort, host: "0.0.0.0" });
    void syncGatewayRegistration();
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

void start();
