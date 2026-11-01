// Tests of worker/index.js without Cloudflare: a local RSA key plays the Access signing key.
// Run: node scripts/test_worker.mjs
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import worker from "../worker/index.js";

const TEAM = "https://team.cloudflareaccess.com";
const AUD = "aud-test";
const OWNER = "owner@example.com";

const keyPair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
);
const otherKeyPair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
);
const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

globalThis.fetch = async (url) => {
  if (String(url) === `${TEAM}/cdn-cgi/access/certs`) {
    return Response.json({ keys: [{ ...publicJwk, kid: "k1", alg: "RS256" }] });
  }
  throw new Error(`Unexpected fetch ${url}`);
};

const b64url = (bytes) => Buffer.from(bytes).toString("base64url");

async function sign(claims = {}, { kid = "k1", key = keyPair.privateKey } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iss: TEAM, aud: [AUD], email: OWNER, iat: now, nbf: now, exp: now + 3600, type: "app", ...claims }));
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(new Uint8Array(signature))}`;
}

const FILES = {
  "/app/data/dashboard.json": ["application/json", "{}"],
  "/app/index.html": ["text/html", "<html>app</html>"],
  "/fonts.css": ["text/css", "body{}"],
};
const ASSETS = {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    const file = FILES[path] || FILES[`${path}index.html`];
    if (!file) return new Response(null, { status: 404 });
    return new Response(file[1], { headers: { "Content-Type": file[0] } });
  },
};

const ENV = {
  ACCESS_TEAM_DOMAIN: "team",
  ACCESS_AUD: AUD,
  ALLOWED_EMAIL: "Owner@Example.com",
  CAPTURE_BASE_URL: "https://capture.example.com/",
  INTAKE_SHARED_SECRET: "test-secret",
  INTAKE_MAX_UPLOAD_BYTES: "4096",
  INTAKE_TICKET_TTL_SECONDS: "600",
  ASSETS,
};

const call = (path, { method = "GET", headers = {}, env = ENV, base = "https://sante.example.com" } = {}) =>
  worker.fetch(new Request(`${base}${path}`, { method, headers }), env);

// Fail closed without configuration.
for (const missing of ["ACCESS_TEAM_DOMAIN", "ACCESS_AUD", "ALLOWED_EMAIL"]) {
  const response = await call("/app/", { env: { ...ENV, [missing]: "" }, headers: { "cf-access-jwt-assertion": await sign() } });
  assert.equal(response.status, 503, missing);
}

// No token, bad tokens: 403 on every route, assets included.
for (const path of ["/", "/app/", "/app/data/dashboard.json", "/fonts.css", "/missing"]) {
  const response = await call(path);
  assert.equal(response.status, 403, path);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
}
assert.equal((await call("/api/create-intake-ticket", { method: "POST" })).status, 403);
const badTokens = {
  garbage: "not-a-jwt",
  audience: await sign({ aud: ["other"] }),
  issuer: await sign({ iss: "https://evil.cloudflareaccess.com" }),
  expired: await sign({ exp: Math.floor(Date.now() / 1000) - 3600 }),
  future: await sign({ nbf: Math.floor(Date.now() / 1000) + 3600 }),
  email: await sign({ email: "intruder@example.com" }),
  signature: await sign({}, { key: otherKeyPair.privateKey }),
  kid: await sign({}, { kid: "unknown" }),
};
for (const [name, token] of Object.entries(badTokens)) {
  const response = await call("/app/data/dashboard.json", { headers: { "cf-access-jwt-assertion": token } });
  assert.equal(response.status, 403, name);
}

// Access keys unreachable: still 403.
const down = await call("/app/", { env: { ...ENV, ACCESS_TEAM_DOMAIN: "down" }, headers: { "cf-access-jwt-assertion": await sign({ iss: "https://down.cloudflareaccess.com" }) } });
assert.equal(down.status, 403);

// Valid token, in the header or the CF_Authorization cookie.
const token = await sign();
const auth = { "cf-access-jwt-assertion": token };
let response = await call("/app/data/dashboard.json", { headers: auth });
assert.equal(response.status, 200);
assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
assert.match(response.headers.get("content-security-policy"), /connect-src 'self' https:\/\/capture\.example\.com;/);
assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
assert.equal(response.headers.get("strict-transport-security"), "max-age=31536000");
response = await call("/app/", { headers: { cookie: `foo=bar; CF_Authorization=${token}` } });
assert.equal(response.status, 200);
assert.equal(await response.text(), "<html>app</html>");
response = await call("/fonts.css", { headers: auth });
assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
response = await call("/missing", { headers: auth });
assert.equal(response.status, 404);
assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
assert.equal((await call("/app/", { method: "POST", headers: auth })).status, 405);
response = await call("/app/share-target/", { method: "POST", headers: auth });
assert.equal(response.status, 303);
assert.equal(response.headers.get("location"), "/app/capture/?share_error=no-photo");
response = await call("/app/", { base: "http://sante.example.com" });
assert.equal(response.status, 301);
assert.equal(response.headers.get("location"), "https://sante.example.com/app/");

// Upload ticket: same contract as the former Netlify function, signature checked like the VPS does.
assert.equal((await call("/api/create-intake-ticket", { headers: auth })).status, 405);
for (const path of ["/api/create-intake-ticket", "/.netlify/functions/create-intake-ticket"]) {
  response = await call(path, { method: "POST", headers: { ...auth, origin: "https://sante.example.com" } });
  assert.equal(response.status, 200, path);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  const body = await response.json();
  assert.equal(body.upload_url, "https://capture.example.com/v1/meal-photo-intake");
  assert.equal(body.max_bytes, 4096);
  assert.match(body.ticket, /^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/);
  const [encoded, signature] = body.ticket.split(".");
  assert.equal(signature, createHmac("sha256", "test-secret").update(encoded).digest("hex"));
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  assert.equal(payload.email, OWNER);
  assert.equal(payload.aud, "https://capture.example.com");
  assert.equal(payload.origin, "https://sante.example.com");
  assert.equal(payload.exp - payload.iat, 600);
  assert.equal(body.expires_at, new Date(payload.exp * 1000).toISOString());
}
response = await call("/api/create-intake-ticket", { method: "POST", headers: auth, env: { ...ENV, INTAKE_SHARED_SECRET: "" } });
assert.equal(response.status, 500);

console.log("Worker OK");
