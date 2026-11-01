// Verification of the Cloudflare Access application token (RS256 JWT).
// Cloudflare Access sends it in the Cf-Access-Jwt-Assertion header (and the CF_Authorization cookie).
// Keys: https://<team>.cloudflareaccess.com/cdn-cgi/access/certs, cached per isolate.

const CLOCK_SKEW_SECONDS = 60;
const JWKS_TTL_MS = 60 * 60 * 1000;
const jwksCache = new Map();

export class AccessError extends Error {}

export function normalizeTeamDomain(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  const host = raw.replace(/^https?:\/\//, "");
  return `https://${host.includes(".") ? host : `${host}.cloudflareaccess.com`}`;
}

function base64UrlToBytes(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function decodeJson(segment) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment)));
}

export function readAccessToken(request) {
  const header = request.headers.get("cf-access-jwt-assertion");
  if (header) return header.trim();
  const cookies = request.headers.get("cookie") || "";
  const match = cookies.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return match ? match[1].trim() : "";
}

async function loadKeys(issuer, { force = false } = {}) {
  const cached = jwksCache.get(issuer);
  if (!force && cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return cached.keys;
  let keys = [];
  try {
    const response = await fetch(`${issuer}/cdn-cgi/access/certs`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    ({ keys = [] } = await response.json());
  } catch (error) {
    throw new AccessError(`Access certs unavailable (${error.message}).`);
  }
  const imported = new Map();
  for (const jwk of keys) {
    if (jwk.kty !== "RSA" || !jwk.kid) continue;
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    imported.set(jwk.kid, key);
  }
  jwksCache.set(issuer, { keys: imported, fetchedAt: Date.now() });
  return imported;
}

// Returns the verified payload, or throws AccessError.
export async function verifyAccessToken(token, { teamDomain, audience, now = Date.now() }) {
  const issuer = normalizeTeamDomain(teamDomain);
  if (!issuer || !audience) throw new AccessError("Access is not configured.");
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new AccessError("Missing or malformed Access token.");
  const [encodedHeader, encodedPayload, encodedSignature] = parts;

  let header;
  let payload;
  try {
    header = decodeJson(encodedHeader);
    payload = decodeJson(encodedPayload);
  } catch {
    throw new AccessError("Malformed Access token.");
  }
  if (header.alg !== "RS256" || !header.kid) throw new AccessError("Unsupported Access token.");

  let keys = await loadKeys(issuer);
  if (!keys.has(header.kid)) keys = await loadKeys(issuer, { force: true });
  const key = keys.get(header.kid);
  if (!key) throw new AccessError("Unknown Access signing key.");

  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlToBytes(encodedSignature),
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
  );
  if (!valid) throw new AccessError("Invalid Access token signature.");

  const nowSeconds = Math.floor(now / 1000);
  if (payload.iss !== issuer) throw new AccessError("Access token issuer mismatch.");
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(audience)) throw new AccessError("Access token audience mismatch.");
  if (typeof payload.exp !== "number" || payload.exp + CLOCK_SKEW_SECONDS < nowSeconds) {
    throw new AccessError("Expired Access token.");
  }
  if (typeof payload.nbf === "number" && payload.nbf - CLOCK_SKEW_SECONDS > nowSeconds) {
    throw new AccessError("Access token not yet valid.");
  }
  return payload;
}
