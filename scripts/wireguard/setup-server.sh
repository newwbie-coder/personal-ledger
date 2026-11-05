#!/bin/sh
# Turn this Linux box into the office WireGuard server.
# Usage: sudo ./setup-server.sh <public-ip-or-hostname> [port]
set -eu

ENDPOINT="${1:-}"
PORT="${2:-51820}"
WG_DIR=/etc/wireguard
CONF="$WG_DIR/wg0.conf"

if [ "$(id -u)" != 0 ]; then echo "Run as root (sudo)." >&2; exit 1; fi
if [ -z "$ENDPOINT" ]; then
  echo "Usage: sudo $0 <office-public-ip-or-hostname> [port]" >&2
  exit 1
fi

if ! command -v wg >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update && apt-get install -y wireguard qrencode
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y wireguard-tools qrencode
  else
    echo "Install wireguard-tools with your package manager, then re-run." >&2
    exit 1
  fi
fi

umask 077
mkdir -p "$WG_DIR/phones"

if [ -f "$CONF" ]; then
  echo "$CONF already exists; leaving keys alone."
else
  wg genkey > "$WG_DIR/server.key"
  wg pubkey < "$WG_DIR/server.key" > "$WG_DIR/server.pub"
  cat > "$CONF" <<EOF
# Ledger office box. Phones reach only 10.8.0.1; nothing is forwarded to the office LAN.
[Interface]
Address = 10.8.0.1/24
ListenPort = $PORT
PrivateKey = $(cat "$WG_DIR/server.key")
EOF
fi

echo "$ENDPOINT:$PORT" > "$WG_DIR/ledger-endpoint"

systemctl enable --now wg-quick@wg0
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q active; then
  ufw allow "$PORT/udp"
  ufw allow in on wg0 to any port 443 proto tcp
  ufw allow in on wg0 to any port 80 proto tcp
fi

echo
echo "WireGuard is running on UDP $PORT."
echo "On the office router, forward UDP $PORT (and nothing else) to this machine."
echo "Box public key: $(cat "$WG_DIR/server.pub")"
echo "Add a phone with: sudo ./add-phone.sh <name>"
