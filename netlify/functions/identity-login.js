const {
  forbiddenResponse,
  isAllowedIdentity,
  jsonResponse,
  parseEventUser,
  withHealthRole,
} = require("./_auth_policy");

exports.handler = async (event) => {
  const user = parseEventUser(event);

  if (!isAllowedIdentity(user)) {
    return forbiddenResponse("Connexion reservee au compte Google autorise.");
  }

  return jsonResponse(200, withHealthRole(user));
};
