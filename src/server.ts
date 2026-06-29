import Fastify from "fastify";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { IncomingHttpHeaders } from "node:http";
import { config } from "./config.js";
import { deriveWireGuardPublicKey } from "./wireguard.js";
import { verifyGatewaySignature } from "./auth.js";
import type {
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

const peers: PeerStatus[] = [
  {
    publicKey: "peer-a-public-key",
    allowedIps: ["10.10.0.2/32"],
    lastHandshakeAt: null,
    rxBytes: 0,
    txBytes: 0,
  },
];

const snapshot = (): ServerSnapshot => ({
  name: config.serverName,
  listenPort: config.listenPort,
  peerNetwork: config.peerNetwork,
  online: true,
  loadPercent: 24,
  publicKey: serverPublicKey,
  peers,
});

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

  return {
    ok: true,
    removed: before - peers.length,
  };
});

const start = async (): Promise<void> => {
  try {
    await app.listen({ port: config.port, host: "0.0.0.0" });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

void start();
