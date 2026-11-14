#!/bin/bash
# Install Satoyama GP as system services reachable at https://racing.local
#
#   sudo ./deploy/install.sh
#
# Idempotent — safe to re-run after editing any unit file. Does not touch the
# other *.local vhosts.
#
#   racing.service              — server.mjs (static dist/) on 127.0.0.1:3013
#   avahi-alias-racing.service  — publishes racing.local over mDNS

set -euo pipefail

REPO="/home/junius/Web/forza"
PORT=3013
cd "$REPO"

if [ "$(id -u)" -ne 0 ]; then
    echo "Run with sudo: sudo ./deploy/install.sh" >&2
    exit 1
fi

if [ ! -f dist/index.html ]; then
    echo "dist/ is missing — build first (as junius): npm install && npm run build" >&2
    exit 1
fi

echo "==> Checking port $PORT is free"
if ss -ltn "sport = :$PORT" | grep -q ":$PORT"; then
    if systemctl is-active --quiet racing.service; then
        echo "    held by racing.service (will be restarted)"
    else
        echo "    port $PORT is in use by something else — resolve before installing" >&2
        ss -ltnp "sport = :$PORT" >&2
        exit 1
    fi
fi

echo "==> Ensuring the TLS certificate covers racing.local"
# All vhosts on this box share /etc/nginx/ssl/local.crt. Read the SANs already
# on the cert, add racing.local if missing, and reissue with the same key so
# nothing else about the box's TLS changes.
CRT=/etc/nginx/ssl/local.crt
KEY=/etc/nginx/ssl/local.key

if openssl x509 -in "$CRT" -noout -ext subjectAltName 2>/dev/null | grep -q 'DNS:racing.local'; then
    echo "    already covered — leaving certificate alone"
else
    existing="$(openssl x509 -in "$CRT" -noout -ext subjectAltName 2>/dev/null \
        | tr ',' '\n' | grep -oE '(DNS|IP Address):[^ ]+' \
        | sed 's/IP Address:/IP:/' | paste -sd, -)"
    SANS="${existing:+$existing,}DNS:racing.local"
    backup="$CRT.bak.$(date +%Y%m%d%H%M%S)"
    cp -a "$CRT" "$backup"
    echo "    reissuing with: $SANS"
    echo "    previous certificate saved to $backup"
    openssl req -x509 -new -key "$KEY" -sha256 -days 3650 \
        -subj "/CN=leetlive.local" \
        -addext "subjectAltName=$SANS" \
        -out "$CRT"
    chmod 644 "$CRT"
fi

echo "==> Installing nginx vhost"
install -m 644 deploy/nginx-racing.conf /etc/nginx/sites-available/racing
ln -sfn /etc/nginx/sites-available/racing /etc/nginx/sites-enabled/racing
nginx -t
systemctl reload nginx

echo "==> Installing systemd units"
chmod +x deploy/avahi-alias-racing.sh
install -m 644 deploy/racing.service              /etc/systemd/system/
install -m 644 deploy/avahi-alias-racing.service  /etc/systemd/system/
systemctl daemon-reload

echo "==> Enabling and starting services"
systemctl enable --now avahi-alias-racing.service
systemctl restart racing.service 2>/dev/null || true
systemctl enable --now racing.service

sleep 2

echo
echo "==> Status"
for svc in avahi-alias-racing racing; do
    printf '    %-22s %s\n' "$svc" "$(systemctl is-active $svc.service)"
done

echo
echo "==> Reachability"
code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/" || echo "000")
echo "    127.0.0.1:$PORT        -> HTTP $code"
code=$(curl -sk -o /dev/null -w '%{http_code}' --resolve racing.local:443:127.0.0.1 https://racing.local/ || echo "000")
echo "    https://racing.local   -> HTTP $code"
echo "    mDNS: $(avahi-resolve -n racing.local 2>&1 | head -1)"

echo
echo "Done. Open https://racing.local from any device on the LAN."
