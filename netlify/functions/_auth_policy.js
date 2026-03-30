const ALLOWED_EMAIL = String(process.env.ALLOWED_EMAIL || process.env.AUTHORIZED_EMAIL || "").trim().toLowerCase();
const ALLOWED_PROVIDER = String(process.env.ALLOWED_PROVIDER || "google").trim().toLowerCase();

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function parseEventUser(event) {
  if (!event?.body) return {};
  try {
    const payload = JSON.parse(event.body);
    return payload?.user || {};
  } catch (_) {
    return {};
  }
}

function getIdentity(user = {}) {
  return {
    email: normalize(user.email),
    provider: normalize(user?.app_metadata?.provider),
  };
}

function isAllowedIdentity(user = {}) {
  const { email, provider } = getIdentity(user);
  return email === ALLOWED_EMAIL && provider === ALLOWED_PROVIDER;
}

function withHealthRole(user = {}) {
  const appMetadata = user.app_metadata || {};
  const roles = new Set(Array.isArray(appMetadata.roles) ? appMetadata.roles : []);
  roles.add("health");
  return {
    app_metadata: {
      ...appMetadata,
      roles: Array.from(roles),
    },
  };
}

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store, max-age=0",
    },
    body: JSON.stringify(payload),
  };
}

function forbiddenResponse(message) {
  return {
    statusCode: 403,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "private, no-store, max-age=0",
    },
    body: message,
  };
}

module.exports = {
  ALLOWED_EMAIL,
  ALLOWED_PROVIDER,
  forbiddenResponse,
  getIdentity,
  isAllowedIdentity,
  jsonResponse,
  parseEventUser,
  withHealthRole,
};
