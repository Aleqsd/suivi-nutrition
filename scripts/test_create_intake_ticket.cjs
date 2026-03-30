const assert = require("node:assert/strict");

process.env.ALLOWED_EMAIL = "authorized@example.com";
process.env.ALLOWED_PROVIDER = "google";
process.env.CAPTURE_BASE_URL = "https://capture.example.com";
process.env.INTAKE_SHARED_SECRET = "test-secret";
process.env.INTAKE_MAX_UPLOAD_BYTES = "4096";
process.env.INTAKE_TICKET_TTL_SECONDS = "600";

const handler = require("../netlify/functions/create-intake-ticket.js").handler;

async function main() {
  const allowedUser = {
    email: "authorized@example.com",
    app_metadata: {
      provider: "google",
      roles: ["health"],
    },
  };

  const response = await handler(
    {
      headers: {
        origin: "https://atlas.example.com",
      },
    },
    {
      clientContext: {
        user: allowedUser,
      },
    },
  );

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.upload_url, "https://capture.example.com/v1/meal-photo-intake");
  assert.equal(body.max_bytes, 4096);
  assert.match(body.ticket, /^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/);

  const denied = await handler(
    { headers: { origin: "https://atlas.example.com" } },
    {
      clientContext: {
        user: {
          email: "intruder@example.com",
          app_metadata: { provider: "google", roles: ["health"] },
        },
      },
    },
  );
  assert.equal(denied.statusCode, 403);

  console.log("Create intake ticket function OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
