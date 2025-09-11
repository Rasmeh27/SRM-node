// src/index.js (integrado)
const http = require("http");
const { authenticate } = require("./middleware/auth");
const { handlePrescriptions } = require("./routes/prescriptions.routes");
const { handleHistory } = require("./routes/history.routes");
const { handleGrants } = require("./routes/grants.routes");

const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  // 1) Auth
  const auth = authenticate(req);
  if (!auth.ok) {
    res.writeHead(403, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: auth.error }));
  }
  const user = auth.user;

  // 2) Routers
  if (await handlePrescriptions(req, res, user)) return;
  if (await handleHistory(req, res, user)) return;
  if (await handleGrants(req, res, user)) return;

  // 3) 404
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not Found" }));
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`El puerto ${PORT} está en uso. Usa PORT=3001 (PowerShell: $env:PORT=3001; npm run dev)`);
  } else {
    console.error(err);
  }
});

server.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
