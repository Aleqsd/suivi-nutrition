#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <tunnel-token>" >&2
  exit 1
fi

TUNNEL_TOKEN="$1"
ENV_PATH="/etc/default/cloudflared-sante"
UNIT_PATH="/etc/systemd/system/cloudflared-sante.service"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "[cloudflared] cloudflared is not installed." >&2
  exit 1
fi

sudo tee "$ENV_PATH" > /dev/null <<EOF
TUNNEL_TOKEN=$TUNNEL_TOKEN
EOF
sudo chmod 600 "$ENV_PATH"

sudo tee "$UNIT_PATH" > /dev/null <<'EOF'
[Unit]
Description=Cloudflare Tunnel for sante.zqsdev.com
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/default/cloudflared-sante
ExecStart=/bin/sh -lc 'exec /usr/bin/cloudflared tunnel --no-autoupdate run --token "$TUNNEL_TOKEN"'
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now cloudflared-sante.service
sudo systemctl restart cloudflared-sante.service
sudo systemctl --no-pager --full status cloudflared-sante.service
