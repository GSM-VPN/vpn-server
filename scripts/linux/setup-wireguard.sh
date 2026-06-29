#!/usr/bin/env bash
set -euo pipefail

TUNNEL_NAME="${TUNNEL_NAME:-gsm-vpn}"
LISTEN_PORT="${LISTEN_PORT:-51820}"
SERVER_ADDRESS="${SERVER_ADDRESS:-10.10.0.1/24}"
SERVER_PRIVATE_KEY="${SERVER_PRIVATE_KEY:-}"
PEER_NETWORK="${PEER_NETWORK:-10.10.0.0/24}"
WG_TOOL_PATH="${WG_TOOL_PATH:-wg}"

if [[ -z "${SERVER_PRIVATE_KEY}" ]]; then
  echo "SERVER_PRIVATE_KEY is required."
  exit 1
fi

if command -v apt-get >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y wireguard-tools
elif command -v dnf >/dev/null 2>&1; then
  sudo dnf install -y wireguard-tools
elif command -v yum >/dev/null 2>&1; then
  sudo yum install -y wireguard-tools
elif command -v pacman >/dev/null 2>&1; then
  sudo pacman -S --noconfirm wireguard-tools
elif command -v zypper >/dev/null 2>&1; then
  sudo zypper --non-interactive install wireguard-tools
elif command -v apk >/dev/null 2>&1; then
  sudo apk add wireguard-tools
else
  echo "No supported package manager found. Install wireguard-tools manually."
fi

if command -v sysctl >/dev/null 2>&1; then
  sudo sysctl -w net.ipv4.ip_forward=1
  sudo sysctl -w net.ipv6.conf.all.forwarding=1 || true
fi

OUTBOUND_INTERFACE="$(ip route show default 0.0.0.0/0 | awk '{print $5; exit}')"
if [[ -z "${OUTBOUND_INTERFACE}" ]]; then
  OUTBOUND_INTERFACE="$(ip route show default | awk '{print $5; exit}')"
fi

sudo install -d -m 700 /etc/wireguard
CONFIG_PATH="/etc/wireguard/${TUNNEL_NAME}.conf"

cat <<EOF | sudo tee "${CONFIG_PATH}" >/dev/null
[Interface]
PrivateKey = ${SERVER_PRIVATE_KEY}
Address = ${SERVER_ADDRESS}
ListenPort = ${LISTEN_PORT}
PostUp = iptables -t nat -A POSTROUTING -s ${PEER_NETWORK} -o ${OUTBOUND_INTERFACE} -j MASQUERADE
PostDown = iptables -t nat -D POSTROUTING -s ${PEER_NETWORK} -o ${OUTBOUND_INTERFACE} -j MASQUERADE
EOF

sudo chmod 600 "${CONFIG_PATH}"

if command -v systemctl >/dev/null 2>&1; then
  sudo systemctl enable --now "wg-quick@${TUNNEL_NAME}"
else
  sudo wg-quick up "${CONFIG_PATH}"
fi

echo "WireGuard prepared: ${CONFIG_PATH}"
