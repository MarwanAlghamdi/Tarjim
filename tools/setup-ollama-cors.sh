#!/usr/bin/env bash
# Grants the browser extension permission to talk to the local Ollama server.
#
# Ollama refuses any request whose Origin header it does not recognise, and
# chrome-extension:// is not in its default allowlist -- it answers 403 before
# the request ever reaches a model. This adds OLLAMA_ORIGINS to the systemd
# unit WITHOUT touching the existing OLLAMA_HOST drop-in.
set -euo pipefail

ORIGINS="${OLLAMA_ORIGINS_VALUE:-*}"
DROPIN_DIR=/etc/systemd/system/ollama.service.d
DROPIN=$DROPIN_DIR/20-origins.conf

if [ "$(id -u)" -ne 0 ]; then
  echo "This script must run as root:  sudo $0" >&2
  exit 1
fi

mkdir -p "$DROPIN_DIR"
cat > "$DROPIN" <<EOF
[Service]
Environment="OLLAMA_ORIGINS=$ORIGINS"
EOF

echo "Wrote $DROPIN:"
cat "$DROPIN"

systemctl daemon-reload
systemctl restart ollama

for _ in $(seq 1 20); do
  curl -sf -o /dev/null http://localhost:11434/api/version && break
  sleep 0.5
done

echo
echo "Effective environment:"
systemctl show ollama --property=Environment

echo
echo -n "Verification (expect 200, was 403): "
curl -s -o /dev/null -w '%{http_code}\n' \
  http://localhost:11434/api/tags \
  -H 'Origin: chrome-extension://abcdefghijklmnopabcdefghijklmnop'
