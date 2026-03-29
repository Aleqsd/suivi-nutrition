const assert = require("node:assert/strict");

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
    email: "aleqsd@gmail.com",
    app_metadata: {
      provider: "google",
      roles: [],
    },
  };

  const disallowedProviderUser = {
    email: "aleqsd@gmail.com",
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

  const validateWrongProvider = await invoke(validate, disallowedProviderUser);
  assert.equal(validateWrongProvider.statusCode, 403);

  const signupAllowed = await invoke(signup, allowedUser);
  assert.equal(signupAllowed.statusCode, 200);
  assert.deepEqual(parseJsonBody(signupAllowed).app_metadata.roles, ["health"]);

  const signupDenied = await invoke(signup, disallowedProviderUser);
  assert.equal(signupDenied.statusCode, 403);

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

  console.log("Identity function policy OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
