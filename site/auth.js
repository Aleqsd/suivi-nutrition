// Cloudflare Access authenticates the visitor before any page of this site is served.
// This script only checks that the protected data answers, and sends an expired session back through Access.
const page = document.body.dataset.page || "";
const statusNode = document.getElementById("auth-status");
const loginButton = document.getElementById("auth-login");
const logoutButton = document.getElementById("auth-logout");
const PROTECTED_DATA_PATH = "/app/data/dashboard.json";
const PROTECTED_PAGES = new Set(["app", "capture"]);
const ACCESS_LOGOUT_PATH = "/cdn-cgi/access/logout";
const PROTECTED_ACCESS_RETRY_DELAYS_MS = [0, 500, 1500];
const SESSION_RECOVERY_DELAYS_MS = [0, 500, 1500, 3000, 5000];
const authReadyState = createDeferred();
window.__atlasAuthReady = authReadyState.promise;

const AUTH_STATUS_MESSAGES = {
  unauthorized: "Ce compte n'est pas autorisé. Reconnecte-toi avec l'adresse autorisée.",
  expired: "La session Cloudflare Access a expiré. Rouvre le tableau de bord pour te reconnecter.",
  session_pending: "Les données protégées ne répondent pas encore. Réessaie dans quelques secondes.",
};

function createDeferred() {
  let settled = false;
  let resolvePromise = () => {};
  const promise = new Promise((resolve) => {
    resolvePromise = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
  });
  return { promise, resolve: resolvePromise };
}

function setAppAuthState(state) {
  if (!PROTECTED_PAGES.has(page)) return;
  document.body.dataset.authState = state;
}

function setStatus(message, tone = "info") {
  if (!statusNode) return;
  statusNode.textContent = message;
  statusNode.dataset.tone = tone;
}

function setButtonBusy(isBusy) {
  if (!loginButton) return;
  loginButton.disabled = isBusy;
  loginButton.dataset.busy = isBusy ? "true" : "false";
}

function redirectToLogin(reason = "") {
  authReadyState.resolve({ authorized: false, reason });
  const url = new URL("/", window.location.origin);
  if (reason) url.searchParams.set("auth", reason);
  window.location.replace(url.toString());
}

function buildNoStoreUrl(path) {
  const url = new URL(path, window.location.origin);
  url.searchParams.set("_ts", String(Date.now()));
  return url.toString();
}

function wait(delayMs) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

// An expired Access session answers with a redirect to the Access login page (opaque with redirect: "manual")
// or a network error; the Worker answers 403 to a token that is not the allowed one.
async function probeProtectedDataAccess() {
  let response;
  try {
    response = await fetch(buildNoStoreUrl(PROTECTED_DATA_PATH), {
      cache: "no-store",
      credentials: "same-origin",
      redirect: "manual",
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    return { authorized: false, reason: "expired" };
  }
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    return { authorized: false, reason: "expired" };
  }
  if (response.status === 401 || response.status === 403) return { authorized: false, reason: "unauthorized" };
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (response.ok && contentType.includes("application/json")) return { authorized: true, reason: "" };
  return { authorized: false, reason: "session_pending" };
}

async function ensureProtectedAppAccess({ extended = false } = {}) {
  const delays = extended ? SESSION_RECOVERY_DELAYS_MS : PROTECTED_ACCESS_RETRY_DELAYS_MS;
  let reason = "session_pending";
  for (const delayMs of delays) {
    if (delayMs) await wait(delayMs);
    const probe = await probeProtectedDataAccess();
    if (probe.authorized) return { accessReady: true, reason: "" };
    reason = probe.reason;
    if (reason !== "session_pending") break;
  }
  return { accessReady: false, reason };
}

window.__atlasEnsureProtectedAccess = async function atlasEnsureProtectedAccess(options = {}) {
  return ensureProtectedAppAccess(options);
};

function showAuthStateFromUrl() {
  const authState = new URLSearchParams(window.location.search).get("auth");
  const message = AUTH_STATUS_MESSAGES[authState];
  if (!message) return false;
  setStatus(message, authState === "session_pending" ? "info" : "error");
  return true;
}

async function initLoginPage() {
  // Reaching this page means Access already let the visitor in (again, after an expired session):
  // go to the dashboard as soon as the protected data answers.
  const shown = showAuthStateFromUrl();
  if (new URLSearchParams(window.location.search).get("auth") === "unauthorized") return;
  setButtonBusy(true);
  if (!shown) setStatus("Session Cloudflare Access active. Ouverture du tableau de bord…", "info");
  const { accessReady, reason } = await ensureProtectedAppAccess();
  if (accessReady) {
    window.location.replace("/app/");
    return;
  }
  setButtonBusy(false);
  setStatus(AUTH_STATUS_MESSAGES[reason] || AUTH_STATUS_MESSAGES.session_pending, "error");
}

async function initProtectedPage() {
  setAppAuthState("pending");
  let result = await ensureProtectedAppAccess();
  if (!result.accessReady && result.reason === "session_pending") {
    result = await ensureProtectedAppAccess({ extended: true });
  }
  if (!result.accessReady) {
    redirectToLogin(result.reason);
    return;
  }
  setAppAuthState("ready");
  authReadyState.resolve({ authorized: true });
}

if (loginButton) {
  loginButton.addEventListener("click", () => {
    setButtonBusy(true);
    // A top-level navigation lets Access show its login page when the session has expired.
    window.location.assign("/app/");
  });
}

if (logoutButton) {
  logoutButton.addEventListener("click", () => {
    window.location.assign(ACCESS_LOGOUT_PATH);
  });
}

function initAuth() {
  if (PROTECTED_PAGES.has(page)) {
    initProtectedPage();
  } else if (page === "login") {
    initLoginPage();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAuth, { once: true });
} else {
  initAuth();
}
