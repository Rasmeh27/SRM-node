// src/routes/prescriptions.routes.js (integrado)
const { requireRole, requireAnyRole } = require("../middleware/rbac");
const { logAction } = require("../middleware/audit");
const {
  listMedications,
  createPrescription,
  signPrescription,
  buildVerifyToken,
  verifyScanToken,
  anchorOnChain,
  dispense,
  listPrescriptions,
} = require("../services/prescriptions.service");

function send(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
  return true;
}
function sendErr(res, out) {
  res.writeHead(out.status || 400, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: out.error || "Bad request" }));
  return true;
}
function pathOnly(url) { return url.split("?")[0]; }
async function readJson(req, limit = 1e6) {
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

async function handlePrescriptions(req, res, user) {
  const p = pathOnly(req.url);
  const url = new URL(req.url, "http://localhost");

  try {
    // ---- GET /api/medications ----
    if (req.method === "GET" && p === "/api/medications") {
      const meds = await listMedications();
      return send(res, 200, meds);
    }

    // ---- GET /api/prescriptions (listado simple por rol) ----
    if (req.method === "GET" && p === "/api/prescriptions") {
      const out = listPrescriptions({
        requester: user,
        doctorId: url.searchParams.get("doctorId"),
        patientId: url.searchParams.get("patientId"),
      });
      if (!out.ok) return sendErr(res, out);
      return send(res, 200, out.data);
    }

    // ---- POST /api/prescriptions (crear) ----
    if (req.method === "POST" && p === "/api/prescriptions") {
      const chk = requireRole(user, "doctor");
      if (!chk.ok) return send(res, 403, { error: chk.error });
      const body = await readJson(req).catch(() => null);
      if (!body) return send(res, 400, { error: "Invalid JSON body" });
      const out = createPrescription({
        doctorId: user.id,
        patientId: body.patient_id || body.patientId,
        items: body.items || [],
        notes: body.notes || null,
      });
      if (!out.ok) return sendErr(res, out);
      logAction(req, user.id, "RX_CREATE", "prescription", out.data.id, { by: user.id });
      return send(res, 201, out.data);
    }

    // ---- POST /api/prescriptions/:id/sign ----
    const mSign = req.method === "POST" && /^\/api\/prescriptions\/([^\/]+)\/sign$/.exec(p);
    if (mSign) {
      const id = mSign[1];
      const chk = requireRole(user, "doctor");
      if (!chk.ok) return send(res, 403, { error: chk.error });
      const body = await readJson(req).catch(() => null);
      if (!body || !body.privateKeyPem) return send(res, 400, { error: "privateKeyPem requerido" });
      const out = signPrescription({ doctorId: user.id, prescriptionId: id, privateKeyPem: body.privateKeyPem });
      if (!out.ok) return sendErr(res, out);
      logAction(req, user.id, "RX_SIGN", "prescription", id, { by: user.id });
      return send(res, 200, out.data);
    }

    // ---- POST /api/prescriptions/:id/anchor ----
    const mAnchor = req.method === "POST" && /^\/api\/prescriptions\/([^\/]+)\/anchor$/.exec(p);
    if (mAnchor) {
      const id = mAnchor[1];
      const chk = requireRole(user, "doctor");
      if (!chk.ok) return send(res, 403, { error: chk.error });
      const out = anchorOnChain({ prescriptionId: id, by: user.id });
      if (!out.ok) return sendErr(res, out);
      logAction(req, user.id, "RX_ANCHOR", "prescription", id, { by: user.id, anchor: out.data });
      return send(res, 200, out.data);
    }

    // ---- GET /api/prescriptions/:id/qr ----
    const mQR = req.method === "GET" && /^\/api\/prescriptions\/([^\/]+)\/qr$/.exec(p);
    if (mQR) {
      const id = mQR[1];
      const chk = requireRole(user, "doctor");
      if (!chk.ok) return send(res, 403, { error: chk.error });
      const token = buildVerifyToken({ prescriptionId: id, by: user.id });
      logAction(req, user.id, "RX_QR_TOKEN", "prescription", id, { by: user.id });
      return send(res, 200, { token });
    }

    // ---- GET /api/prescriptions/verify?token=... ----
    if (req.method === "GET" && p === "/api/prescriptions/verify") {
      const token = url.searchParams.get("token");
      const out = verifyScanToken({ token });
      if (!out.ok) return sendErr(res, out);
      logAction(req, user.id, "RX_VERIFY", "prescription", out.data.prescription_id, { by: user.id });
      return send(res, 200, out.data);
    }

    // ---- POST /api/prescriptions/:id/dispense ----
    const mDisp = req.method === "POST" && /^\/api\/prescriptions\/([^\/]+)\/dispense$/.exec(p);
    if (mDisp) {
      const id = mDisp[1];
      const chk = requireRole(user, "pharmacy");
      if (!chk.ok) return send(res, 403, { error: chk.error });
      const body = await readJson(req).catch(() => null);
      const out = dispense({ prescriptionId: id, pharmacyUser: user, body: body || {} });
      if (!out.ok) return sendErr(res, out);
      logAction(req, user.id, "RX_DISPENSE", "prescription", id, { by: user.id });
      return send(res, 200, out.data);
    }

    return false; // no match
  } catch (err) {
    console.error("[prescriptions] error:", err);
    return send(res, 500, { error: "Internal error" });
  }
}

module.exports = { handlePrescriptions };
