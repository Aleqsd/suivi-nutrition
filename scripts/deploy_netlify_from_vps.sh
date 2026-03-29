#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/home/ubuntu/GitHub/suivi-nutrition}"
SITE_DIR="${SITE_DIR:-$APP_DIR/site}"
FUNCTIONS_DIR="${FUNCTIONS_DIR:-$APP_DIR/netlify/functions}"
NETLIFY_SITE_ID="${NETLIFY_SITE_ID:-}"
NETLIFY_AUTH_TOKEN="${NETLIFY_AUTH_TOKEN:-}"
DEPLOY_MESSAGE="${DEPLOY_MESSAGE:-suivi-nutrition deploy}"

if [[ -z "$NETLIFY_SITE_ID" || -z "$NETLIFY_AUTH_TOKEN" ]]; then
  echo "[netlify] Missing NETLIFY_SITE_ID or NETLIFY_AUTH_TOKEN." >&2
  exit 1
fi

if [[ ! -f "$SITE_DIR/index.html" ]]; then
  echo "[netlify] Missing site entrypoint at $SITE_DIR/index.html" >&2
  exit 1
fi

if [[ ! -f "$SITE_DIR/app/data/dashboard.json" ]]; then
  echo "[netlify] Missing generated dashboard data at $SITE_DIR/app/data/dashboard.json" >&2
  exit 1
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "[netlify] npx is required on the VPS." >&2
  exit 1
fi

echo "[netlify] Deploying $SITE_DIR to site $NETLIFY_SITE_ID"
deploy_args=(
  --prod
  --dir "$SITE_DIR"
  --site "$NETLIFY_SITE_ID"
  --auth "$NETLIFY_AUTH_TOKEN"
  --message "$DEPLOY_MESSAGE"
  --no-build
)

if [[ -d "$FUNCTIONS_DIR" ]]; then
  echo "[netlify] Including functions from $FUNCTIONS_DIR"
  deploy_args+=(--functions "$FUNCTIONS_DIR")
fi

npx --yes netlify-cli deploy "${deploy_args[@]}"
