export type PeerStatus = {
  publicKey: string;
  allowedIps: string[];
  lastHandshakeAt: string | null;
  rxBytes: number;
  txBytes: number;
};

export type ServerSnapshot = {
  name: string;
  ip: string;
  udpPort: number;
  tcpPort: number;
  managementUrl: string;
  endpoint: string;
  online: boolean;
  loadPercent: number;
  publicKey: string;
  peers: PeerStatus[];
};

export type GatewayVpnRegisterRequest = {
  ip?: string;
  udpPort?: number;
  tcpPort?: number;
  name?: string;
};

export type GatewayVpnRegisterResponse =
  | {
      ok: true;
      message: string;
      wsKey: string;
      server: {
        id: string;
        name: string;
        ip: string;
        udpPort: number;
        tcpPort: number;
        managementUrl: string;
        endpoint: string;
        loadPercent: number;
        online: boolean;
        publicKey: string;
        lastSeenAt: string | null;
      };
    }
  | { ok: false; message: string };

export type RegisterPeerRequest = {
  publicKey?: string;
  allowedIps?: string[];
  serverId?: string;
  deviceId?: string;
};

export type ReportRequest = {
  gatewayToken?: string;
};

export type RegisterPeerResponse =
  | { ok: true; message: string; peer: PeerStatus | undefined; vpnPublicKey: string }
  | { ok: false; message: string };

export type RemovePeerResponse =
  | { ok: true; removed: number }
  | { ok: false; message: string };
