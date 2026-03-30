const ALLOWED_EMAIL = String(process.env.ALLOWED_EMAIL || process.env.AUTHORIZED_EMAIL || "").trim().toLowerCase();
const ALLOWED_PROVIDER = String(process.env.ALLOWED_PROVIDER || "google").trim().toLowerCase();
const SOFT_ALLOWED_PROVIDERS = new Set([ALLOWED_PROVIDER, "email"]);

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function parseEventUser(event) {
  if (!event?.body) return {};
  try {
    const payload = JSON.parse(event.body);
    if (payload?.user && typeof payload.user === "object") return payload.user;
    if (payload?.payload?.user && typeof payload.payload.user === "object") return payload.payload.user;
    if (payload?.payload && typeof payload.payload === "object") return payload.payload;
    return {};
  } catch (_) {
    return {};
  }
}

function getProviderCandidates(user = {}) {
  const providers = [];
  const pushProvider = (value) => {
    const normalized = normalize(value);
    if (normalized && !providers.includes(normalized)) {
      providers.push(normalized);
    }
  };

  pushProvider(user?.app_metadata?.provider);
  pushProvider(user?.user_metadata?.provider);
  if (Array.isArray(user?.identities)) {
    user.identities.forEach((identity) => pushProvider(identity?.provider));
  }
  if (Array.isArray(user?.app_metadata?.providers)) {
    user.app_metadata.providers.forEach((provider) => pushProvider(provider));
  }
  return providers;
}

function getIdentity(user = {}) {
  const providers = getProviderCandidates(user);
  return {
    email: normalize(user.email),
    provider: providers[0] || "",
  };
}

function getContextUser(context = {}) {
  return context?.clientContext?.user || {};
}

function isAllowedEmail(user = {}) {
  return getIdentity(user).email === ALLOWED_EMAIL;
}

function isAllowedIdentity(user = {}, { allowMissingProvider = false } = {}) {
  const { email, provider } = getIdentity(user);
  if (email !== ALLOWED_EMAIL) return false;
  if (!provider) return allowMissingProvider;
  return provider === ALLOWED_PROVIDER;
}

function isSoftAllowedProvider(user = {}) {
  const { provider } = getIdentity(user);
  return !provider || SOFT_ALLOWED_PROVIDERS.has(provider);
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
  getContextUser,
  getIdentity,
  isAllowedEmail,
  isAllowedIdentity,
  isSoftAllowedProvider,
  jsonResponse,
  parseEventUser,
  withHealthRole,
};
