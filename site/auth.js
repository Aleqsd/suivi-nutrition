const page = document.body.dataset.page || "";
const statusNode = document.getElementById("auth-status");
const loginButton = document.getElementById("auth-login");
const logoutButton = document.getElementById("auth-logout");
const REQUIRED_ROLE = "health";
const PROTECTED_DATA_PATH = "/app/data/dashboard.json";
const PROTECTED_PAGES = new Set(["app", "capture"]);
const authReadyState = createDeferred();
window.__atlasAuthReady = authReadyState.promise;

const AUTH_STATUS_MESSAGES = {
  unauthorized: "Le compte connecté n'a pas le rôle health. Reconnecte-toi avec l'adresse Google invitée.",
  expired: "La session a expiré ou l'accès protégé n'est plus valide. Reconnecte-toi pour continuer.",
  identity_unavailable: "La brique de connexion Netlify Identity n'a pas pu être chargée.",
  session_pending: "La session est créée, mais l'accès protégé n'est pas encore prêt. Réessaie dans quelques secondes.",
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
  return {
    promise,
    resolve: resolvePromise,
  };
}

function resolveAuthReady(result) {
  authReadyState.resolve(result);
}

function setAppAuthState(state) {
  if (!PROTECTED_PAGES.has(page)) return;
  document.body.dataset.authState = state;
}

function getUserRoles(user) {
  return Array.isArray(user?.app_metadata?.roles) ? user.app_metadata.roles : [];
}

function userHasRequiredRole(user) {
  return getUserRoles(user).includes(REQUIRED_ROLE);
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

function redirectToApp() {
  resolveAuthReady({ authorized: true, user: getIdentityUser() });
  window.location.replace("/app/");
}

function redirectToLogin(reason = "") {
  resolveAuthReady({ authorized: false, reason });
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

function getIdentityUser(fallbackUser = null) {
  return window.netlifyIdentity?.currentUser?.() || fallbackUser;
}

async function refreshIdentityJwt(user, forceRefresh = false) {
  const activeUser = getIdentityUser(user);
  if (!activeUser?.jwt) return activeUser;
  await activeUser.jwt(forceRefresh);
  return activeUser;
}

async function probeProtectedDataAccess() {
  const response = await fetch(buildNoStoreUrl(PROTECTED_DATA_PATH), {
    method: "HEAD",
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
    },
  });
  const finalUrl = new URL(response.url, window.location.origin);
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  return {
    authorized: response.ok && finalUrl.pathname.startsWith("/app/") && contentType.includes("application/json"),
    finalPath: finalUrl.pathname,
    contentType,
  };
}

async function waitForProtectedAppAccess(user) {
  const retryDelays = [0, 250, 750, 1500, 2500];
  for (const delayMs of retryDelays) {
    if (delayMs) await wait(delayMs);

    try {
      await refreshIdentityJwt(user, delayMs === 0);
      const probe = await probeProtectedDataAccess();
      if (probe.authorized) {
        return true;
      }
    } catch (error) {
      console.warn("Protected app probe failed.", error);
    }
  }
  return false;
}

async function redirectToAppWhenReady(user, { existingSession = false } = {}) {
  if (page !== "login") {
    setAppAuthState("pending");
    const accessReady = await waitForProtectedAppAccess(user);
    if (accessReady) {
      setAppAuthState("ready");
      resolveAuthReady({ authorized: true, user });
      return true;
    }
    redirectToLogin("session_pending");
    return false;
  }

  setButtonBusy(true);
  setStatus(
    existingSession
      ? "Session détectée. Vérification de l'accès protégé…"
      : "Connexion établie. Vérification de l'accès protégé…",
    "info",
  );

  const accessReady = await waitForProtectedAppAccess(user);
  if (accessReady) {
    redirectToApp();
    return true;
  }

  setButtonBusy(false);
  setStatus(AUTH_STATUS_MESSAGES.session_pending, "error");
  return false;
}

async function bootstrapAppAccess(user) {
  setAppAuthState("pending");

  if (!user) {
    redirectToLogin();
    return false;
  }

  if (!userHasRequiredRole(user)) {
    await handleUnauthorizedUser();
    redirectToLogin("unauthorized");
    return false;
  }

  const accessReady = await waitForProtectedAppAccess(user);
  if (!accessReady) {
    redirectToLogin("session_pending");
    return false;
  }

  setAppAuthState("ready");
  resolveAuthReady({ authorized: true, user });
  return true;
}

function openGoogleLoginDirect() {
  if (!window.netlifyIdentity) {
    setStatus(AUTH_STATUS_MESSAGES.identity_unavailable, "error");
    return;
  }

  const externalLoginUrl = window.netlifyIdentity.gotrue?.loginExternalUrl?.("google")
    || `${window.location.origin}/.netlify/identity/authorize?provider=google`;
  window.location.assign(externalLoginUrl);
}

function hasAuthTokenInUrl() {
  const search = new URLSearchParams(window.location.search);
  const hash = window.location.hash || "";
  return (
    search.has("confirmation_token")
    || search.has("invite_token")
    || search.has("recovery_token")
    || hash.includes("access_token")
  );
}

function showAuthStateFromUrl() {
  const search = new URLSearchParams(window.location.search);
  const authState = search.get("auth");
  const message = AUTH_STATUS_MESSAGES[authState];
  if (!message) return;
  setStatus(message, authState === "session_pending" ? "info" : "error");
}

async function handleUnauthorizedUser() {
  setStatus(AUTH_STATUS_MESSAGES.unauthorized, "error");
  if (!window.netlifyIdentity) return;
  try {
    await window.netlifyIdentity.logout();
  } catch (_) {
    // Ignore logout failures and still bounce back to the login page.
  }
}

function initIdentity() {
  showAuthStateFromUrl();
  if (PROTECTED_PAGES.has(page)) setAppAuthState("pending");

  if (!window.netlifyIdentity) {
    setStatus(AUTH_STATUS_MESSAGES.identity_unavailable, "error");
    if (PROTECTED_PAGES.has(page)) redirectToLogin("identity_unavailable");
    return;
  }

  window.netlifyIdentity.on("init", async (user) => {
    if (page === "login" && hasAuthTokenInUrl()) {
      setButtonBusy(true);
      window.netlifyIdentity.open();
      return;
    }

    if (page === "login" && user && !userHasRequiredRole(user)) {
      setStatus("Compte détecté, mais accès incomplet. Reconnecte-toi avec le compte Google autorisé.", "error");
      return;
    }

    if (page === "login" && userHasRequiredRole(user)) {
      await redirectToAppWhenReady(user, { existingSession: true });
      return;
    }

    if (PROTECTED_PAGES.has(page)) {
      await bootstrapAppAccess(user);
      return;
    }

    if (page === "login") setButtonBusy(false);
  });

  window.netlifyIdentity.on("login", async (user) => {
    window.netlifyIdentity.close();
    if (!userHasRequiredRole(user)) {
      await handleUnauthorizedUser();
      redirectToLogin("unauthorized");
      return;
    }
    await redirectToAppWhenReady(user);
  });

  window.netlifyIdentity.on("logout", () => {
    if (page === "app") redirectToLogin();
  });

  window.netlifyIdentity.on("error", (error) => {
    setButtonBusy(false);
    setStatus(error?.message || "Connexion impossible.", "error");
    if (PROTECTED_PAGES.has(page)) {
      console.error("Identity bootstrap failed.", error);
      redirectToLogin("identity_unavailable");
    }
  });

  window.netlifyIdentity.init();
}

if (loginButton) {
  loginButton.addEventListener("click", () => {
    setButtonBusy(true);
    setStatus("Redirection vers Google…");
    openGoogleLoginDirect();
  });
}

if (logoutButton) {
  logoutButton.addEventListener("click", async () => {
    if (!window.netlifyIdentity) {
      redirectToLogin("identity_unavailable");
      return;
    }
    try {
      await window.netlifyIdentity.logout();
    } catch (error) {
      console.error("Logout failed.", error);
      redirectToLogin("expired");
    }
  });
}

window.__atlasGetAccessToken = async function atlasGetAccessToken(forceRefresh = false) {
  const user = getIdentityUser();
  if (!user?.jwt) return "";
  return user.jwt(forceRefresh);
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initIdentity, { once: true });
} else {
  initIdentity();
}
