#!/bin/sh
# Creates the office's own certificate authority and HTTPS certificate on first start.
# Phones install ca.crt once; the CA key never leaves this box.
set -eu

TLS_DIR="${LEDGER_DATA_DIR:-/data}/tls"
HOSTS="${BOX_HOSTS:-10.8.0.1}"
mkdir -p "$TLS_DIR"
chmod 700 "$TLS_DIR"

if [ ! -f "$TLS_DIR/ca.key" ]; then
  echo "Creating the office certificate authority"
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
    -keyout "$TLS_DIR/ca.key" -out "$TLS_DIR/ca.crt" -days 3650 \
    -subj "/CN=Ledger Office Box CA" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null
fi

san="DNS:localhost,IP:127.0.0.1"
old_ifs="$IFS"
IFS=','
for h in $HOSTS; do
  h=$(echo "$h" | tr -d ' ')
  [ -z "$h" ] && continue
  if echo "$h" | grep -Eq '^[0-9]+(\.[0-9]+){3}$'; then
    san="$san,IP:$h"
  else
    san="$san,DNS:$h"
  fi
done
IFS="$old_ifs"

needs_cert=0
[ -f "$TLS_DIR/server.crt" ] || needs_cert=1
[ "$(cat "$TLS_DIR/server.san" 2>/dev/null || true)" = "$san" ] || needs_cert=1
if [ "$needs_cert" = 0 ] && ! openssl x509 -checkend 2592000 -noout -in "$TLS_DIR/server.crt" >/dev/null; then
  needs_cert=1
fi

if [ "$needs_cert" = 1 ]; then
  echo "Issuing HTTPS certificate for: $san"
  ext="$TLS_DIR/server.ext"
  cat > "$ext" <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=$san
EOF
  openssl req -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
    -keyout "$TLS_DIR/server.key" -out "$TLS_DIR/server.csr" \
    -subj "/CN=Ledger Office Box" 2>/dev/null
  # Apple devices reject server certificates valid for more than 825 days.
  openssl x509 -req -in "$TLS_DIR/server.csr" -CA "$TLS_DIR/ca.crt" -CAkey "$TLS_DIR/ca.key" \
    -CAcreateserial -out "$TLS_DIR/server.crt" -days 825 -extfile "$ext" 2>/dev/null
  rm -f "$ext" "$TLS_DIR/server.csr"
  echo "$san" > "$TLS_DIR/server.san"
fi

chmod 600 "$TLS_DIR"/*.key
chown -R node:node "${LEDGER_DATA_DIR:-/data}" "${BACKUP_DIR:-/backups}"
exec su-exec node "$@"
