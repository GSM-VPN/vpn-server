type VpnConfig = {
  httpPort: number;
  internalUdpPort: number;
  externalUdpPort: number;
  externalHttpPort: number;
  serverName: string;
  serverIp: string;
  gatewayUrl: string;
  serverPrivateKey: string;
  peerNetwork: string;
  tunnelName: string;
  gatewaySharedSecret: string;
  wgToolPath: string;
  heartbeatIntervalMs: number;
};

export const config: VpnConfig = {
  httpPort: Number(process.env.HTTP_PORT ?? 8081),
  internalUdpPort: Number(process.env.INTERNAL_UDP_PORT ?? 51820),
  externalUdpPort: Number(process.env.EXTERNAL_UDP_PORT ?? process.env.INTERNAL_UDP_PORT ?? 51820),
  externalHttpPort: Number(process.env.EXTERNAL_HTTP_PORT ?? process.env.HTTP_PORT ?? 8081),
  serverName: process.env.SERVER_NAME ?? "GSM-VPN Server",
  serverIp: process.env.SERVER_IP ?? "127.0.0.1",
  gatewayUrl: process.env.GATEWAY_URL ?? "http://127.0.0.1:8080",
  serverPrivateKey: process.env.SERVER_PRIVATE_KEY ?? "",
  peerNetwork: process.env.PEER_NETWORK ?? "10.10.0.0/24",
  tunnelName: process.env.TUNNEL_NAME ?? "gsm-vpn",
  gatewaySharedSecret: process.env.GATEWAY_SHARED_SECRET ?? "dev-only-gateway-secret-change-me",
  wgToolPath: process.env.WG_TOOL_PATH ?? "wg",
  heartbeatIntervalMs: Number(process.env.HEARTBEAT_INTERVAL_MS ?? 15000),
};
