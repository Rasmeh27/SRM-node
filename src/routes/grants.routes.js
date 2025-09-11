// src/routes/grants.routes.js
const {
  createGrant,
  revokeGrant,
  listMyGrants,
} = require("../services/grants.service");
const { logAction } = require("../middleware/audit");

async function handleGrants(req, res, user) {
  try {
    // Solo pacientes pueden administrar grants
    if (user.role !== "patient") return false;

    // POST /api/grants
    if (req.method === "POST" && req.url === "/api/grants") {
      const body = await readJsonBody(req).catch(() => null);
      if (!body || !body.granteeId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "granteeId requerido" }));
      }

      const result = createGrant({
        patientId: user.id,
        granteeId: body.granteeId,
        expiresAt: body.expiresAt,
      });

      if (!result.ok) {
        res.writeHead(result.status || 400, {
          "Content-Type": "application/json",
        });
        return res.end(JSON.stringify({ error: result.error }));
      }

      logAction(req, user.id, "GRANT_CREATED", "grant", result.data.id, {
        granteeId: body.granteeId,
      });
      res.writeHead(201, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(result.data));
    }

    // DELETE /api/grants/:id
    const delMatch =
      req.method === "DELETE" && /^\/api\/grants\/([^/]+)$/.test(req.url);
    if (delMatch) {
      const [, grantId] = req.url.match(/^\/api\/grants\/([^/]+)$/);
      const result = revokeGrant({ patientId: user.id, grantId });
      if (!result.ok) {
        res.writeHead(result.status || 400, {
          "Content-Type": "application/json",
        });
        return res.end(JSON.stringify({ error: result.error }));
      }
      logAction(req, user.id, "GRANT_REVOKED", "grant", grantId);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(result.data));
    }

    // GET /api/grants (mis grants)
    if (req.method === "GET" && req.url === "/api/grants") {
      const result = listMyGrants(user.id);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(result.data));
    }

    return false;
  } catch (e) {
    console.error("[grants] error:", e);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal error" }));
    return true;
  }
}

async function readJsonBody(req, limit = 1e6) {
  return await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > limit) reject(new Error("Body too large"));
    });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error("Invalid JSON")); }
    });
  });
}

module.exports = { handleGrants };
