#!/usr/bin/env bash
# Publishes site/ (with the dashboard.json generated on the VPS) and worker/ to the Cloudflare Worker sante-zqsdev.
# Needs CLOUDFLARE_API_TOKEN (Workers Scripts: Edit on the account, Workers Routes: Edit on zqsdev.com) and Node >= 22.
set -euo pipefail

APP_DIR="${APP_DIR:-/home/ubuntu/GitHub/suivi-nutrition}"
SITE_DIR="${SITE_DIR:-$APP_DIR/site}"
WRANGLER_CONFIG="${WRANGLER_CONFIG:-$APP_DIR/wrangler.jsonc}"
WRANGLER_PACKAGE="${WRANGLER_PACKAGE:-wrangler@4}"
CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:-}"
DEPLOY_MESSAGE="${DEPLOY_MESSAGE:-suivi-nutrition deploy}"

if [[ -z "$CLOUDFLARE_API_TOKEN" ]]; then
  echo "[cloudflare] Missing CLOUDFLARE_API_TOKEN." >&2
  exit 1
fi

if [[ ! -f "$WRANGLER_CONFIG" ]]; then
  echo "[cloudflare] Missing Wrangler config at $WRANGLER_CONFIG" >&2
  exit 1
fi

if [[ ! -f "$SITE_DIR/index.html" ]]; then
  echo "[cloudflare] Missing site entrypoint at $SITE_DIR/index.html" >&2
  exit 1
fi

if [[ ! -f "$SITE_DIR/app/data/dashboard.json" ]]; then
  echo "[cloudflare] Missing generated dashboard data at $SITE_DIR/app/data/dashboard.json" >&2
  exit 1
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "[cloudflare] npx is required on the VPS." >&2
  exit 1
fi

echo "[cloudflare] Deploying $SITE_DIR and worker/ with $WRANGLER_CONFIG"
cd "$APP_DIR"
CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN" \
  npx --yes "$WRANGLER_PACKAGE" deploy --config "$WRANGLER_CONFIG" --message "$DEPLOY_MESSAGE"
