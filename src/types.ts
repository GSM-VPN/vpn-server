export type PeerStatus = {
  publicKey: string;
  allowedIps: string[];
  lastHandshakeAt: string | null;
  rxBytes: number;
  txBytes: number;
};

export type ServerSnapshot = {
  name: string;
  listenPort: number;
  peerNetwork: string;
  online: boolean;
  loadPercent: number;
  publicKey: string;
  peers: PeerStatus[];
};

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
