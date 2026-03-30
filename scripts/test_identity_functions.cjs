const assert = require("node:assert/strict");

const allowedEmail = String(process.env.ALLOWED_EMAIL || process.env.AUTHORIZED_EMAIL || "authorized@example.com").trim().toLowerCase();

process.env.ALLOWED_EMAIL = allowedEmail;

const validate = require("../netlify/functions/identity-validate.js").handler;
const signup = require("../netlify/functions/identity-signup.js").handler;
const login = require("../netlify/functions/identity-login.js").handler;

function buildEvent(user) {
  return {
    body: JSON.stringify({
      event: "test",
      user,
    }),
  };
}

async function invoke(handler, user) {
  return handler(buildEvent(user));
}

function parseJsonBody(response) {
  return JSON.parse(response.body || "{}");
}

async function main() {
  const allowedUser = {
    email: allowedEmail,
    app_metadata: {
      provider: "google",
      roles: [],
    },
  };

  const disallowedProviderUser = {
    email: allowedEmail,
    app_metadata: {
      provider: "email",
      roles: [],
    },
  };

  const disallowedEmailUser = {
    email: "intrus@example.com",
    app_metadata: {
      provider: "google",
      roles: [],
    },
  };

  const validateAllowed = await invoke(validate, allowedUser);
  assert.equal(validateAllowed.statusCode, 200);

  const validateWrongEmail = await invoke(validate, disallowedEmailUser);
  assert.equal(validateWrongEmail.statusCode, 403);

  const validateSoftAllowedProvider = await invoke(validate, disallowedProviderUser);
  assert.equal(validateSoftAllowedProvider.statusCode, 200);
  assert.deepEqual(parseJsonBody(validateSoftAllowedProvider).app_metadata.roles, ["health"]);

  const signupAllowed = await invoke(signup, allowedUser);
  assert.equal(signupAllowed.statusCode, 204);

  const signupNestedPayload = await signup({
    body: JSON.stringify({
      payload: {
        email: allowedEmail,
        app_metadata: {},
        identities: [{ provider: "google" }],
      },
    }),
  });
  assert.equal(signupNestedPayload.statusCode, 204);

  const signupWrongEmail = await invoke(signup, disallowedEmailUser);
  assert.equal(signupWrongEmail.statusCode, 403);

  const signupDenied = await invoke(signup, disallowedProviderUser);
  assert.equal(signupDenied.statusCode, 204);

  const signupUnknownShape = await signup({
    body: JSON.stringify({
      payload: {
        app_metadata: {},
      },
    }),
  });
  assert.equal(signupUnknownShape.statusCode, 204);

  const loginAllowed = await invoke(login, {
    ...allowedUser,
    app_metadata: {
      provider: "google",
      roles: ["existing"],
    },
  });
  assert.equal(loginAllowed.statusCode, 200);
  assert.deepEqual(parseJsonBody(loginAllowed).app_metadata.roles.sort(), ["existing", "health"]);

  const loginDenied = await invoke(login, disallowedEmailUser);
  assert.equal(loginDenied.statusCode, 403);

  const loginSoftAllowedProvider = await invoke(login, disallowedProviderUser);
  assert.equal(loginSoftAllowedProvider.statusCode, 200);

  const loginWithoutProvider = await invoke(login, {
    email: allowedEmail,
    app_metadata: {
      roles: ["health"],
    },
  });
  assert.equal(loginWithoutProvider.statusCode, 200);

  console.log("Identity function policy OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
