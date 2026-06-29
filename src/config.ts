type VpnConfig = {
  port: number;
  listenPort: number;
  serverName: string;
  serverPrivateKey: string;
  peerNetwork: string;
  tunnelName: string;
  gatewaySharedSecret: string;
  wgToolPath: string;
};

export const config: VpnConfig = {
  port: Number(process.env.PORT ?? 8081),
  listenPort: Number(process.env.LISTEN_PORT ?? 51820),
  serverName: process.env.SERVER_NAME ?? "GSM-VPN Server",
  serverPrivateKey: process.env.SERVER_PRIVATE_KEY ?? "",
  peerNetwork: process.env.PEER_NETWORK ?? "10.10.0.0/24",
  tunnelName: process.env.TUNNEL_NAME ?? "gsm-vpn",
  gatewaySharedSecret: process.env.GATEWAY_SHARED_SECRET ?? "dev-only-gateway-secret-change-me",
  wgToolPath: process.env.WG_TOOL_PATH ?? "wg",
};
