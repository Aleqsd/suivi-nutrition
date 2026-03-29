const {
  ALLOWED_EMAIL,
  ALLOWED_PROVIDER,
  forbiddenResponse,
  getIdentity,
  jsonResponse,
  parseEventUser,
} = require("./_auth_policy");

exports.handler = async (event) => {
  const user = parseEventUser(event);
  const { email, provider } = getIdentity(user);

  if (email !== ALLOWED_EMAIL) {
    return forbiddenResponse("Acces reserve au compte invite.");
  }

  if (provider && provider !== ALLOWED_PROVIDER) {
    return forbiddenResponse("Connexion Google obligatoire.");
  }

  return jsonResponse(200, {});
};
