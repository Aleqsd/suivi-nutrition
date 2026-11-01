// Cloudflare Worker for sante.zqsdev.com, in front of the site/ assets (run_worker_first: every request comes here).
// Cloudflare Access authenticates the visitor before the Worker runs. The Worker checks again, on every route,
// that the request carries a valid Access token for ACCESS_AUD whose email is ALLOWED_EMAIL; otherwise 403.
// Without ACCESS_TEAM_DOMAIN, ACCESS_AUD or ALLOWED_EMAIL it answers 503: it never serves anything unauthenticated.
// Routes:
// - POST /api/create-intake-ticket (alias of the former /.netlify/functions/create-intake-ticket): signed upload
//   ticket for the capture service on the VPS (CAPTURE_BASE_URL), same format as before.
// - POST /app/share-target/ without the service worker: back to the capture page.
// - everything else: static file from site/, with the headers formerly in site/_headers.

import { AccessError, readAccessToken, verifyAccessToken } from "./access.js";

const NO_STORE = "private, no-store, max-age=0";
const IMMUTABLE = "public, max-age=31536000, immutable";
const TICKET_PATHS = new Set(["/api/create-intake-ticket", "/.netlify/functions/create-intake-ticket"]);
const DEFAULT_MAX_BYTES = 12 * 1024 * 1024;
const DEFAULT_TTL_SECONDS = 30 * 60;

function contentSecurityPolicy(env) {
  const capture = String(env.CAPTURE_BASE_URL || "").trim().replace(/\/+$/, "");
  return [
    "default-src 'self'",
    "script-src 'self'",
    `connect-src 'self'${capture ? ` ${capture}` : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

function cacheControlFor(path) {
  if (path === "/fonts.css" || path.startsWith("/fonts/")) return IMMUTABLE;
  return NO_STORE;
}

function withHeaders(response, path, env) {
  const out = new Response(response.body, response);
  const headers = out.headers;
  headers.set("Cache-Control", response.status === 200 || response.status === 304 ? cacheControlFor(path) : NO_STORE);
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Content-Security-Policy", contentSecurityPolicy(env));
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set(
    "Permissions-Policy",
    "accelerometer=(), autoplay=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()",
  );
  headers.set("Strict-Transport-Security", "max-age=31536000");
  return out;
}

const text = (status, body, extra = {}) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", ...extra } });

const json = (status, payload) =>
  new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

// Returns { email } for the allowed visitor, or a Response to send back.
async function authenticate(request, env) {
  const allowedEmail = String(env.ALLOWED_EMAIL || "").trim().toLowerCase();
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || !allowedEmail) {
    return text(503, "Accès non configuré.");
  }
  try {
    const payload = await verifyAccessToken(readAccessToken(request), {
      teamDomain: env.ACCESS_TEAM_DOMAIN,
      audience: env.ACCESS_AUD,
    });
    const email = String(payload.email || "").trim().toLowerCase();
    if (email !== allowedEmail) return text(403, "Accès réservé au compte autorisé.");
    return { email };
  } catch (error) {
    if (error instanceof AccessError) return text(403, "Accès réservé au compte autorisé.");
    throw error;
  }
}

function base64UrlFromString(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const toHex = (bytes) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");

async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

// Same contract as the former Netlify function: { ticket, expires_at, upload_url, max_bytes }.
// The ticket is verified by scripts/meal_photo_intake_common.py:verify_intake_ticket on the VPS.
async function createIntakeTicket(request, env, { email }) {
  const captureBaseUrl = String(env.CAPTURE_BASE_URL || "").trim().replace(/\/+$/, "");
  const secret = String(env.INTAKE_SHARED_SECRET || "").trim();
  if (!captureBaseUrl || !secret) return json(500, { error: "Missing capture service configuration." });

  const maxBytes = Number(env.INTAKE_MAX_UPLOAD_BYTES || DEFAULT_MAX_BYTES);
  const ttlSeconds = Number(env.INTAKE_TICKET_TTL_SECONDS || DEFAULT_TTL_SECONDS);
  const origin = String(request.headers.get("origin") || "").trim().replace(/\/+$/, "") || new URL(request.url).origin;
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    email,
    provider: "cloudflare-access",
    origin,
    aud: captureBaseUrl,
    max_bytes: maxBytes,
    iat: issuedAt,
    exp: issuedAt + ttlSeconds,
    nonce: toHex(crypto.getRandomValues(new Uint8Array(8))),
  };
  const encodedPayload = base64UrlFromString(JSON.stringify(payload));
  const signature = await hmacSha256Hex(secret, encodedPayload);
  return json(200, {
    ticket: `${encodedPayload}.${signature}`,
    expires_at: new Date(payload.exp * 1000).toISOString(),
    upload_url: `${captureBaseUrl}/v1/meal-photo-intake`,
    max_bytes: maxBytes,
  });
}

const NOT_FOUND = `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page introuvable</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem"><h1>Page introuvable</h1><p><a href="/app/">Retour au tableau de bord</a></p></body></html>`;

async function route(request, env, identity) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (TICKET_PATHS.has(path)) {
    if (method !== "POST") return text(405, "Method not allowed.", { Allow: "POST" });
    return createIntakeTicket(request, env, identity);
  }
  if (path === "/app/share-target/" && method === "POST") {
    return new Response(null, { status: 303, headers: { Location: "/app/capture/?share_error=no-photo" } });
  }
  if (method !== "GET" && method !== "HEAD") return text(405, "Method not allowed.", { Allow: "GET, HEAD" });

  const response = await env.ASSETS.fetch(request);
  if (response.status === 404) {
    return new Response(method === "HEAD" ? null : NOT_FOUND, {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  return response;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.protocol === "http:") {
      const location = `https://${url.host}${url.pathname}${url.search}`;
      return withHeaders(new Response(null, { status: 301, headers: { Location: location } }), url.pathname, env);
    }
    const identity = await authenticate(request, env);
    const response = identity instanceof Response ? identity : await route(request, env, identity);
    return withHeaders(response, url.pathname, env);
  },
};
