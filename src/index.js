// src/index.js
require("dotenv").config();
const http = require("http");
const { authUser } = require("./middleware/auth");
const { handleAuth } = require("./routes/auth.routes");
const { handleUsers } = require("./routes/users.routes");
const { handlePrescriptions } = require("./routes/prescriptions.routes");

// ➕ añadir:
const { handleHistory } = require("./routes/history.routes");
const { handleGrants } = require("./routes/grants.routes");

const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-user-id, x-role");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const user = await authUser(req);

  if (await handleAuth(req, res, user)) return;
  if (await handleUsers(req, res, user)) return;
  if (await handlePrescriptions(req, res, user)) return;

  // ➕ montar aquí:
  if (await handleHistory(req, res, user)) return;
  if (await handleGrants(req, res, user)) return;

  res.writeHead(404, { "Content-Type": "application/json" })
     .end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, () => console.log(`SRM-Backend listening on http://localhost:${PORT}`));
