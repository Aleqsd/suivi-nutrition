#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/home/ubuntu/GitHub/suivi-nutrition}"
CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:-}"
DEPLOY_MESSAGE="${DEPLOY_MESSAGE:-suivi-nutrition deploy}"
DEPLOY_MODE="${DEPLOY_MODE:-standard}"
SKIP_PUBLISH="${SKIP_PUBLISH:-0}"

if [[ ! -d "$APP_DIR" ]]; then
  echo "[deploy] Missing app directory: $APP_DIR" >&2
  exit 1
fi

cd "$APP_DIR"
chmod +x scripts/*.sh

case "$DEPLOY_MODE" in
  standard|fast)
    ;;
  *)
    echo "[deploy] Unsupported DEPLOY_MODE: $DEPLOY_MODE" >&2
    exit 1
    ;;
esac

echo "[deploy] Running VPS rebuild pipeline in $APP_DIR ($DEPLOY_MODE mode)"
APP_DIR="$APP_DIR" DEPLOY_MODE="$DEPLOY_MODE" bash scripts/provision_vps.sh

if [[ "$SKIP_PUBLISH" == "1" ]]; then
  echo "[deploy] Skipping Cloudflare publish."
  exit 0
fi

if [[ -z "$CLOUDFLARE_API_TOKEN" ]]; then
  echo "[deploy] Missing CLOUDFLARE_API_TOKEN for publish." >&2
  exit 1
fi

echo "[deploy] Publishing regenerated site to Cloudflare"
APP_DIR="$APP_DIR" \
CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN" \
DEPLOY_MESSAGE="$DEPLOY_MESSAGE" \
bash scripts/deploy_cloudflare_from_vps.sh
