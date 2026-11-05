#!/bin/sh
# Enroll one phone. Prints a QR code to scan in the WireGuard app.
# The phone's private key is shown once and is not kept on the box.
# Usage: sudo ./add-phone.sh <name>
set -eu

NAME="${1:-}"
WG_DIR=/etc/wireguard
CONF="$WG_DIR/wg0.conf"

if [ "$(id -u)" != 0 ]; then echo "Run as root (sudo)." >&2; exit 1; fi
if ! echo "$NAME" | grep -Eq '^[A-Za-z0-9_-]{1,32}$'; then
  echo "Usage: sudo $0 <name>   (letters, digits, - and _ only)" >&2
  exit 1
fi
if [ -f "$WG_DIR/phones/$NAME.pub" ]; then
  echo "A phone named $NAME already exists. Remove it first." >&2
  exit 1
fi

umask 077
n=2
while grep -q "AllowedIPs = 10.8.0.$n/32" "$CONF"; do
  n=$((n + 1))
  [ "$n" -gt 254 ] && { echo "No free addresses left." >&2; exit 1; }
done
ADDR="10.8.0.$n"

priv=$(wg genkey)
pub=$(echo "$priv" | wg pubkey)
psk=$(wg genpsk)
echo "$pub" > "$WG_DIR/phones/$NAME.pub"

cat >> "$CONF" <<EOF

# BEGIN phone $NAME
[Peer]
PublicKey = $pub
PresharedKey = $psk
AllowedIPs = $ADDR/32
# END phone $NAME
EOF

pskfile=$(mktemp)
echo "$psk" > "$pskfile"
wg set wg0 peer "$pub" preshared-key "$pskfile" allowed-ips "$ADDR/32"
rm -f "$pskfile"

client="[Interface]
PrivateKey = $priv
Address = $ADDR/32

[Peer]
PublicKey = $(cat "$WG_DIR/server.pub")
PresharedKey = $psk
Endpoint = $(cat "$WG_DIR/ledger-endpoint")
AllowedIPs = 10.8.0.1/32
PersistentKeepalive = 25"

echo "Phone $NAME gets $ADDR. Scan this in the WireGuard app (Add tunnel > Scan from QR code):"
echo
if command -v qrencode >/dev/null 2>&1; then
  echo "$client" | qrencode -t ansiutf8
else
  echo "$client" | docker compose exec -T app node apps/api/dist/box-cli.js qr
fi
echo
echo "Then open https://10.8.0.1 on the phone."
