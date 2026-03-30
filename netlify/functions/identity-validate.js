const {
  ALLOWED_EMAIL,
  forbiddenResponse,
  getIdentity,
  jsonResponse,
  parseEventUser,
  withHealthRole,
} = require("./_auth_policy");

exports.handler = async (event) => {
  const user = parseEventUser(event);
  const { email } = getIdentity(user);

  if (email !== ALLOWED_EMAIL) {
    return forbiddenResponse("Acces reserve au compte invite.");
  }

  return jsonResponse(200, withHealthRole(user));
};
