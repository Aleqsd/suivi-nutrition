const crypto = require("node:crypto");

const {
  forbiddenResponse,
  getContextUser,
  getIdentity,
  isAllowedIdentity,
  jsonResponse,
} = require("./_auth_policy");

const CAPTURE_BASE_URL = String(process.env.CAPTURE_BASE_URL || "").trim().replace(/\/+$/, "");
const INTAKE_SHARED_SECRET = String(process.env.INTAKE_SHARED_SECRET || "").trim();
const MAX_BYTES = Number(process.env.INTAKE_MAX_UPLOAD_BYTES || 12 * 1024 * 1024);
const TTL_SECONDS = Number(process.env.INTAKE_TICKET_TTL_SECONDS || 30 * 60);

function base64UrlEncode(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function signPayload(encodedPayload) {
  return crypto.createHmac("sha256", INTAKE_SHARED_SECRET).update(encodedPayload).digest("hex");
}

function buildOrigin(event = {}) {
  const explicitOrigin = String(event?.headers?.origin || "").trim().replace(/\/+$/, "");
  if (explicitOrigin) return explicitOrigin;
  const siteUrl = String(process.env.URL || process.env.DEPLOY_PRIME_URL || "").trim().replace(/\/+$/, "");
  return siteUrl;
}

exports.handler = async (event, context) => {
  if (!CAPTURE_BASE_URL || !INTAKE_SHARED_SECRET) {
    return {
      statusCode: 500,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "private, no-store, max-age=0",
      },
      body: JSON.stringify({ error: "Missing capture service configuration." }),
    };
  }

  const user = getContextUser(context);
  if (!isAllowedIdentity(user)) {
    return forbiddenResponse("Connexion reservee au compte Google autorise.");
  }

  const { email, provider } = getIdentity(user);
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    email,
    provider,
    origin: buildOrigin(event),
    aud: CAPTURE_BASE_URL,
    max_bytes: MAX_BYTES,
    iat: issuedAt,
    exp: issuedAt + TTL_SECONDS,
    nonce: crypto.randomBytes(8).toString("hex"),
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(encodedPayload);

  return jsonResponse(200, {
    ticket: `${encodedPayload}.${signature}`,
    expires_at: new Date(payload.exp * 1000).toISOString(),
    upload_url: `${CAPTURE_BASE_URL}/v1/meal-photo-intake`,
    max_bytes: MAX_BYTES,
  });
};
