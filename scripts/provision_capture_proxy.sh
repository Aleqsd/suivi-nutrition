#!/usr/bin/env bash
set -euo pipefail

CAPTURE_SERVER_NAME="${CAPTURE_SERVER_NAME:-}"
CAPTURE_UPSTREAM="${CAPTURE_UPSTREAM:-127.0.0.1:43818}"
CADDY_SNIPPET_PATH="${CADDY_SNIPPET_PATH:-/etc/caddy/Caddyfile.d/suivi-nutrition-capture.caddy}"
MAIN_CADDYFILE="${MAIN_CADDYFILE:-/etc/caddy/Caddyfile}"
IMPORT_GLOB="${IMPORT_GLOB:-/etc/caddy/Caddyfile.d/*.caddy}"
NGINX_SITE_PATH="${NGINX_SITE_PATH:-/etc/nginx/sites-available/${CAPTURE_SERVER_NAME}}"
NGINX_SITE_LINK="${NGINX_SITE_LINK:-/etc/nginx/sites-enabled/${CAPTURE_SERVER_NAME}}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-${ALLOWED_EMAIL:-}}"

if [[ -z "$CAPTURE_SERVER_NAME" ]]; then
  echo "[capture-proxy] Missing CAPTURE_SERVER_NAME." >&2
  exit 1
fi

configure_nginx_proxy() {
  sudo mkdir -p "$(dirname "$NGINX_SITE_PATH")" "$(dirname "$NGINX_SITE_LINK")"
  sudo tee "$NGINX_SITE_PATH" > /dev/null <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $CAPTURE_SERVER_NAME;

    client_max_body_size 32m;
    add_header Cache-Control "private, no-store, max-age=0" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer" always;

    location / {
        proxy_pass http://$CAPTURE_UPSTREAM;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Connection "";
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
EOF

  sudo ln -sf "$NGINX_SITE_PATH" "$NGINX_SITE_LINK"
  sudo nginx -t
  sudo systemctl reload nginx

  if command -v certbot >/dev/null 2>&1 && [[ -n "$LETSENCRYPT_EMAIL" ]]; then
    sudo certbot --nginx --non-interactive --agree-tos --redirect \
      --email "$LETSENCRYPT_EMAIL" \
      -d "$CAPTURE_SERVER_NAME"
    sudo nginx -t
    sudo systemctl reload nginx
  fi

  if command -v caddy >/dev/null 2>&1; then
    sudo systemctl disable --now caddy >/dev/null 2>&1 || true
  fi

  echo "[capture-proxy] Nginx proxy configured for https://$CAPTURE_SERVER_NAME -> $CAPTURE_UPSTREAM"
}

configure_caddy_proxy() {
  if ! command -v caddy >/dev/null 2>&1; then
    echo "[capture-proxy] Missing caddy binary on this host." >&2
    exit 1
  fi

  sudo mkdir -p "$(dirname "$MAIN_CADDYFILE")"
  sudo mkdir -p "$(dirname "$CADDY_SNIPPET_PATH")"

  if [[ ! -f "$MAIN_CADDYFILE" ]]; then
    sudo tee "$MAIN_CADDYFILE" > /dev/null <<EOF
{
}

import $IMPORT_GLOB
EOF
  elif ! sudo grep -Fq "import $IMPORT_GLOB" "$MAIN_CADDYFILE"; then
    printf '\nimport %s\n' "$IMPORT_GLOB" | sudo tee -a "$MAIN_CADDYFILE" > /dev/null
  fi

  sudo tee "$CADDY_SNIPPET_PATH" > /dev/null <<EOF
$CAPTURE_SERVER_NAME {
  encode zstd gzip

  header {
    Cache-Control "private, no-store, max-age=0"
    X-Content-Type-Options "nosniff"
    Referrer-Policy "no-referrer"
  }

  reverse_proxy $CAPTURE_UPSTREAM
}
EOF

  sudo caddy validate --config "$MAIN_CADDYFILE"
  sudo systemctl enable --now caddy
  sudo systemctl reload caddy

  echo "[capture-proxy] Caddy proxy configured for https://$CAPTURE_SERVER_NAME -> $CAPTURE_UPSTREAM"
}

if command -v nginx >/dev/null 2>&1; then
  configure_nginx_proxy
  exit 0
fi

configure_caddy_proxy
