#!/bin/sh
# Cut off a lost or retired phone immediately.
# Usage: sudo ./remove-phone.sh <name>
set -eu

NAME="${1:-}"
WG_DIR=/etc/wireguard
CONF="$WG_DIR/wg0.conf"
PUBFILE="$WG_DIR/phones/$NAME.pub"

if [ "$(id -u)" != 0 ]; then echo "Run as root (sudo)." >&2; exit 1; fi
if [ -z "$NAME" ] || [ ! -f "$PUBFILE" ]; then
  echo "No phone named '$NAME'. Enrolled phones:" >&2
  ls "$WG_DIR/phones" 2>/dev/null | sed 's/\.pub$//' >&2
  exit 1
fi

wg set wg0 peer "$(cat "$PUBFILE")" remove
sed -i "/^# BEGIN phone $NAME\$/,/^# END phone $NAME\$/d" "$CONF"
rm -f "$PUBFILE"
echo "Phone $NAME can no longer reach the box."
echo "Also disable that person's ledger account in Settings > Users if they should lose access."
