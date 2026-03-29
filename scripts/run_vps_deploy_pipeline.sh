#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/home/ubuntu/GitHub/suivi-nutrition}"
NETLIFY_SITE_ID="${NETLIFY_SITE_ID:-}"
NETLIFY_AUTH_TOKEN="${NETLIFY_AUTH_TOKEN:-}"
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
  echo "[deploy] Skipping Netlify publish."
  exit 0
fi

if [[ -z "$NETLIFY_SITE_ID" || -z "$NETLIFY_AUTH_TOKEN" ]]; then
  echo "[deploy] Missing NETLIFY_SITE_ID or NETLIFY_AUTH_TOKEN for publish." >&2
  exit 1
fi

echo "[deploy] Publishing regenerated site to Netlify"
APP_DIR="$APP_DIR" \
NETLIFY_SITE_ID="$NETLIFY_SITE_ID" \
NETLIFY_AUTH_TOKEN="$NETLIFY_AUTH_TOKEN" \
DEPLOY_MESSAGE="$DEPLOY_MESSAGE" \
bash scripts/deploy_netlify_from_vps.sh
