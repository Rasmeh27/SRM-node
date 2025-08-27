const { requireRole } = require("../middleware/rbac");
const { logAction } = require("../middleware/audit");
const { dispense } = require("../services/prescriptions.service");

async function handlePrescriptions(req, res, user) {
  try {
    const match =
      req.method === "POST" &&
      /^\/api\/prescriptions\/([^\/]+)\/dispense$/.test(req.url);

    if (!match) return false;

    const [, prescriptionId] = req.url.match(
      /^\/api\/prescriptions\/([^\/]+)\/dispense$/
    );

    //RBAC: solo farmacias
    const guard = requireRole(user, "pharmacy");
    if (!guard || !guard.ok) {
      // <- añade este “guard” por si acaso
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: guard ? guard.error : "RBAC error" }));
      return true;
    }

    //leer body Json
    const body = await readJsonBody(req).catch(() => null);
    if (!body) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
      return true;
    }

    //llamar al servicio
    const result = dispense({
      prescriptionId,
      pharmacyUser: {
        id: user.id,
        items: body.items || [],
        location: body.location || null,
        verificationMethod: body.verificationMethod || "UNKNOWN",
        notes: body.notes || null,
      },
    });

    if (!result.ok) {
      res.writeHead(result.status || 400, {
        "Content-Type": "application/json",
      });
      res.end(JSON.stringify({ error: result.error }));
      return true;
    }

    logAction(
      req,
      user.id,
      "PRESCRIPTION_DISPENSED",
      "prescription",
      prescriptionId,
      {
        items: body.items || [],
      }
    );

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result.data));
    return true;
  } catch (err) {
    console.error("Route error:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal error" }));
  }
  return true;
}

function readJsonBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > limit) reject(new Error("Body too large"));
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

module.exports = { handlePrescriptions };
