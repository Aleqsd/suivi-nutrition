#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/home/ubuntu/GitHub/suivi-nutrition}"
APP_USER="${APP_USER:-ubuntu}"
APP_GROUP="${APP_GROUP:-ubuntu}"
HOST_BIND="${HOST_BIND:-127.0.0.1}"
HOST_PORT="${HOST_PORT:-43817}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
VENV_DIR="${VENV_DIR:-$APP_DIR/.venv}"
SYSTEMD_UNIT_PATH="/etc/systemd/system/suivi-nutrition-dashboard.service"

echo "[suivi-nutrition] Provisioning VPS for ${APP_DIR}"

sudo apt-get update
sudo apt-get install -y python3-venv python3-pip curl

if [[ ! -d "$APP_DIR" ]]; then
  echo "[suivi-nutrition] Missing app directory: $APP_DIR" >&2
  exit 1
fi

sudo chown -R "$APP_USER:$APP_GROUP" "$APP_DIR"

"$PYTHON_BIN" -m venv "$VENV_DIR"
"$VENV_DIR/bin/pip" install --upgrade pip
"$VENV_DIR/bin/pip" install -r "$APP_DIR/requirements.txt"

"$VENV_DIR/bin/python" "$APP_DIR/scripts/validate.py"
"$VENV_DIR/bin/python" "$APP_DIR/scripts/normalize_journal.py"
"$VENV_DIR/bin/python" "$APP_DIR/scripts/build_derived.py"

sudo tee "$SYSTEMD_UNIT_PATH" > /dev/null <<EOF
[Unit]
Description=Suivi Nutrition local dashboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_GROUP
WorkingDirectory=$APP_DIR
Environment=PYTHONUNBUFFERED=1
ExecStart=$VENV_DIR/bin/python $APP_DIR/scripts/dev_server.py --host $HOST_BIND --port $HOST_PORT
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now suivi-nutrition-dashboard.service
sudo systemctl restart suivi-nutrition-dashboard.service
sudo systemctl --no-pager --full status suivi-nutrition-dashboard.service

echo "[suivi-nutrition] Dashboard available locally on http://${HOST_BIND}:${HOST_PORT}/site/"
