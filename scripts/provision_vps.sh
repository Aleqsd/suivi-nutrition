#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/home/ubuntu/GitHub/suivi-nutrition}"
APP_USER="${APP_USER:-ubuntu}"
APP_GROUP="${APP_GROUP:-ubuntu}"
HOST_BIND="${HOST_BIND:-127.0.0.1}"
HOST_PORT="${HOST_PORT:-43817}"
CAPTURE_HOST_BIND="${CAPTURE_HOST_BIND:-127.0.0.1}"
CAPTURE_PORT="${CAPTURE_PORT:-43818}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
VENV_DIR="${VENV_DIR:-$APP_DIR/.venv}"
DEPLOY_MODE="${DEPLOY_MODE:-standard}"
SYSTEMD_UNIT_PATH="/etc/systemd/system/suivi-nutrition-dashboard.service"
CAPTURE_SYSTEMD_UNIT_PATH="/etc/systemd/system/suivi-nutrition-intake.service"
CAPTURE_ENV_FILE="${CAPTURE_ENV_FILE:-$APP_DIR/.env.capture}"
CAPTURE_PROXY_UPSTREAM="${CAPTURE_PROXY_UPSTREAM:-127.0.0.1:${CAPTURE_PORT}}"

if [[ -f "$CAPTURE_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$CAPTURE_ENV_FILE"
  set +a
fi

if [[ -z "${CAPTURE_SERVER_NAME:-}" && -n "${CAPTURE_BASE_URL:-}" ]]; then
  capture_base_no_scheme="${CAPTURE_BASE_URL#*://}"
  capture_base_host="${capture_base_no_scheme%%/*}"
  CAPTURE_SERVER_NAME="${capture_base_host%%:*}"
fi

echo "[suivi-nutrition] Provisioning VPS for ${APP_DIR} (${DEPLOY_MODE} mode)"

if [[ ! -d "$APP_DIR" ]]; then
  echo "[suivi-nutrition] Missing app directory: $APP_DIR" >&2
  exit 1
fi

case "$DEPLOY_MODE" in
  standard)
    sudo apt-get update
    install_packages=(python3-venv python3-pip curl)
    if ! command -v nginx >/dev/null 2>&1 && ! command -v caddy >/dev/null 2>&1; then
      install_packages+=(caddy)
    fi
    sudo apt-get install -y "${install_packages[@]}"
    sudo chown -R "$APP_USER:$APP_GROUP" "$APP_DIR"
    "$PYTHON_BIN" -m venv "$VENV_DIR"
    "$VENV_DIR/bin/pip" install --upgrade pip
    "$VENV_DIR/bin/pip" install -r "$APP_DIR/requirements.txt"
    ;;
  fast)
    if [[ ! -x "$VENV_DIR/bin/python" ]]; then
      echo "[suivi-nutrition] Missing virtualenv for fast mode: $VENV_DIR" >&2
      echo "[suivi-nutrition] Run a standard deploy once before using fast mode." >&2
      exit 1
    fi
    ;;
  *)
    echo "[suivi-nutrition] Unsupported DEPLOY_MODE: $DEPLOY_MODE" >&2
    exit 1
    ;;
esac

"$VENV_DIR/bin/python" "$APP_DIR/scripts/validate.py"
"$VENV_DIR/bin/python" "$APP_DIR/scripts/normalize_journal.py"
"$VENV_DIR/bin/python" "$APP_DIR/scripts/build_derived.py"

if [[ "$DEPLOY_MODE" == "standard" ]]; then
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

  sudo tee "$CAPTURE_SYSTEMD_UNIT_PATH" > /dev/null <<EOF
[Unit]
Description=Suivi Nutrition meal photo intake
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_GROUP
WorkingDirectory=$APP_DIR
Environment=PYTHONUNBUFFERED=1
EnvironmentFile=-$APP_DIR/.env.capture
ExecStart=$VENV_DIR/bin/python $APP_DIR/scripts/meal_photo_intake_service.py --host $CAPTURE_HOST_BIND --port $CAPTURE_PORT
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

  sudo systemctl daemon-reload
  sudo systemctl enable --now suivi-nutrition-dashboard.service
  sudo systemctl enable --now suivi-nutrition-intake.service
fi

sudo systemctl restart suivi-nutrition-dashboard.service
sudo systemctl --no-pager --full status suivi-nutrition-dashboard.service
sudo systemctl restart suivi-nutrition-intake.service
sudo systemctl --no-pager --full status suivi-nutrition-intake.service

if [[ -n "${CAPTURE_SERVER_NAME:-}" ]]; then
  CAPTURE_SERVER_NAME="$CAPTURE_SERVER_NAME" CAPTURE_UPSTREAM="$CAPTURE_PROXY_UPSTREAM" \
    LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-${ALLOWED_EMAIL:-}}" \
    "$APP_DIR/scripts/provision_capture_proxy.sh"
fi

echo "[suivi-nutrition] Dashboard available locally on http://${HOST_BIND}:${HOST_PORT}/site/"
echo "[suivi-nutrition] Meal photo intake service available locally on http://${CAPTURE_HOST_BIND}:${CAPTURE_PORT}/"
