const {
  forbiddenResponse,
  isAllowedEmail,
  getIdentity,
  parseEventUser,
} = require("./_auth_policy");

exports.handler = async (event) => {
  const user = parseEventUser(event);

  // External-provider signup payloads are not consistent enough to enforce a
  // provider check here. Restrict by email when present and let validate/login
  // apply the health role.
  const { email } = getIdentity(user);
  if (email && !isAllowedEmail(user)) {
    return forbiddenResponse("Seule l'adresse Google autorisee peut creer un compte.");
  }

  return { statusCode: 204 };
};
