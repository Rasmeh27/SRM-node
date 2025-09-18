//Luis Herasme

// src/routes/history.routes.js
// Endpoints para ver historial de recetas/acciones de un paciente.

const { logAction } = require("../middleware/audit");
const { canViewPatientHistory } = require("../middleware/rbac");
const { buildHistoryForPatient } = require("../services/history.service");

// Router de historial. Devuelve true si respondió.
async function handleHistory(req, res, user) {
  const pathOnly = req.url.split("?")[0];
  console.log("[history] recibió:", req.method, pathOnly);

  try {
    // GET /api/history/me → historial del propio paciente (solo role=patient)
    if (req.method === "GET" && pathOnly === "/api/history/me") {
      if (user.role !== "patient") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Only patients can use /history/me" }));
        return true;
      }

      const result = buildHistoryForPatient(user.id);
      if (!result.ok) {
        res.writeHead(result.status || 400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: result.error }));
        return true;
      }

      logAction(req, user.id, "HISTORY_VIEW", "user", user.id, { self: true });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result.data));
      return true;
    }

    // GET /api/patients/:id/history → historial de un paciente (según permisos RBAC)
    const match =
      req.method === "GET" &&
      /^\/api\/patients\/([^\/]+)\/history$/.test(pathOnly);

    if (match) {
      const [, patientId] = pathOnly.match(/^\/api\/patients\/([^\/]+)\/history$/);
      const db = require("../db/storage").loadDB(); // fuente de grants/accesos
      const gate = canViewPatientHistory(user, patientId, db); // valida acceso
      if (!gate.ok) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: gate.error }));
        return true;
      }

      const result = buildHistoryForPatient(patientId);
      if (!result.ok) {
        res.writeHead(result.status || 400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: result.error }));
        return true;
      }

      logAction(req, user.id, "HISTORY_VIEW", "user", patientId, { self: user.id === patientId });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result.data));
      return true;
    }

    return false; // no coincide
  } catch (e) {
    console.error("[history] error:", e);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal error" }));
    return true;
  }
}

module.exports = { handleHistory };
