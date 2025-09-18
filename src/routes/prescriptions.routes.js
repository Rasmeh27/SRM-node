//Luis Herasme

// src/routes/prescriptions.routes.js
// Rutas de recetas: listar/crear/firmar/anclar/verificar/QR/dispensar. Incluye verificación de tokens.

const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const { requireRole } = require("../middleware/rbac");
const { logAction } = require("../middleware/audit");
const {
  listMedications,
  createPrescription,
  signPrescription,
  buildVerifyToken,
  anchorOnChain,
  getAnchorInfo,
  verifyAnchorOnChain,
  dispense,
  listPrescriptions,
} = require("../services/prescriptions.service");
const repo = require("../repositories/prescriptions.repo");

// ======== helpers / utils ========
const SECRET = process.env.JWT_SECRET || "dev-secret"; // compat

// Respuesta JSON simple
function send(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
  return true;
}
// Respuesta de error estándar
function sendErr(res, out) {
  res.writeHead(out.status || 400, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: out.error || "Bad request" }));
  return true;
}
// Solo path (sin query)
function pathOnly(url) { return url.split("?")[0]; }
// Lee body JSON con límite
async function readJson(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
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

// base64url & HMAC helpers (para verificación de tokens)
function b64urlToUtf8(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);
  return Buffer.from(b64, "base64").toString("utf8");
}
function hmacB64url(input, secret) {
  const mac = crypto.createHmac("sha256", secret).update(input).digest("base64");
  return mac.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function timingSafeEq(a, b) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}
// Extrae el id de receta desde el payload (distintos alias)
function extractRxId(payload) {
  return payload?.prescription_id || payload?.prescriptionId || payload?.rx || payload?.pid || null;
}

// ======== main handler ========
async function handlePrescriptions(req, res, user) {
  const p = pathOnly(req.url);
  const url = new URL(req.url, "http://localhost");

  try {
    // GET /api/medications → catálogo de medicamentos
    if (req.method === "GET" && p === "/api/medications") {
      const meds = await listMedications();
      return send(res, 200, meds);
    }

    // GET /api/prescriptions → lista (filtrable por doctor/patient)
    if (req.method === "GET" && p === "/api/prescriptions") {
      if (!user) return send(res, 401, { error: "Auth requerido" });
      const out = await listPrescriptions({
        requester: user,
        doctorId: url.searchParams.get("doctorId"),
        patientId: url.searchParams.get("patientId"),
        order: url.searchParams.get("order") || undefined,
      });
      if (!out.ok) return sendErr(res, out);
      return send(res, 200, out.data);
    }

    // GET /api/prescriptions/verify → verifica token (JWT o HMAC)
    if (req.method === "GET" && p === "/api/prescriptions/verify") {
      let token = url.searchParams.get("token");
      if (!token) return send(res, 400, { error: "token is required" });

      token = token.trim();
      if (token.startsWith("{")) { try { const j = JSON.parse(token); token = j.token || j.t || token; } catch {} }

      const parts = token.split(".");
      if (parts.length < 2) return send(res, 400, { error: "INVALID_TOKEN_FORMAT" });

      // Intenta verificar con varias claves y formatos
      async function tryVerifyWith(secrets, shape) {
        for (const secret of secrets) {
          if (!secret) continue;

          // JWT HS256: header.payload.sig
          if (shape === "jwt" && parts.length === 3) {
            try { return { ok: true, payload: jwt.verify(token, secret, { algorithms: ["HS256"] }) }; }
            catch {}
            // HMAC de header.payload
            const [hB64, pB64, sig] = parts;
            const mac = hmacB64url(`${hB64}.${pB64}`, secret);
            if (timingSafeEq(sig, mac)) {
              try { return { ok: true, payload: JSON.parse(b64urlToUtf8(pB64)) }; }
              catch {}
            }
          }

          // HMAC "payloadB64.mac" (b64url o hex)
          if (shape === "raw") {
            const macGiven = parts[parts.length - 1];
            const payloadB64 = parts.slice(0, -1).join(".");
            let payloadObj = null, payloadJson = null;
            try { payloadJson = b64urlToUtf8(payloadB64); payloadObj = JSON.parse(payloadJson); } catch {}

            const macA = hmacB64url(payloadB64, secret);
            const macB = payloadJson ? hmacB64url(payloadJson, secret) : null;

            const macHexA = crypto.createHmac("sha256", secret).update(payloadB64).digest("hex");
            const macHexB = payloadJson ? crypto.createHmac("sha256", secret).update(payloadJson).digest("hex") : null;

            if (timingSafeEq(macGiven, macA) || (macB && timingSafeEq(macGiven, macB)) ||
                timingSafeEq(macGiven, macHexA) || (macHexB && timingSafeEq(macGiven, macHexB))) {
              return { ok: true, payload: payloadObj ?? {} };
            }
          }
        }
        return { ok: false };
      }

      // saca provisionalmente rxId del payload
      let provisionalRxId = null;
      if (parts.length === 3) { try { provisionalRxId = extractRxId(JSON.parse(b64urlToUtf8(parts[1]))); } catch {} }
      else { try { provisionalRxId = extractRxId(JSON.parse(b64urlToUtf8(parts.slice(0, -1).join(".")))); } catch {} }

      // carga receta para obtener verify_secret (si hay id)
      let rx = null;
      if (provisionalRxId) rx = await repo.getPrescriptionById(provisionalRxId).catch(() => null);

      const candidates = [rx?.verify_secret, process.env.VERIFY_SECRET, process.env.JWT_SECRET, "dev-verify-secret"].filter(Boolean);

      let result = { ok: false, payload: null };
      if (parts.length === 3) { result = await tryVerifyWith(candidates, "jwt"); if (!result.ok) result = await tryVerifyWith(candidates, "raw"); }
      else { result = await tryVerifyWith(candidates, "raw"); }

      if (!result.ok) return send(res, 401, { error: "INVALID_TOKEN_SIGNATURE" });

      const payload = result.payload || {};
      const rxId = extractRxId(payload) || provisionalRxId;
      if (!rxId) return send(res, 400, { error: "Invalid token payload" });

      // exp opcional
      if (payload?.exp && Math.floor(Date.now() / 1000) > Number(payload.exp)) {
        return send(res, 401, { error: "TOKEN_EXPIRED" });
      }

      // arma respuesta de verificación
      rx = await repo.getPrescriptionById(rxId).catch(() => null);
      if (!rx) return send(res, 404, { error: "Prescription not found", rxId });
      const items = await repo.getItemsByRx(rxId);
      const valid = Boolean(rx.signature_b64 && rx.hash_sha256);
      const anchored = Boolean(rx.anchor_txid);

      await logAction(req, user?.id || null, "RX_VERIFY", "prescription", rx.id, { by: user?.id || "public" });

      const { verify_secret, ...safe } = rx;
      return send(res, 200, { valid, anchored, network: rx.anchor_network || null, txid: rx.anchor_txid || null, prescription: { ...safe, items } });
    }

    // POST /api/prescriptions/verify → igual que GET pero por body
    if (req.method === "POST" && p === "/api/prescriptions/verify") {
      const body = await readJson(req).catch(() => ({}));
      const t = String(body?.token || body?.t || "").trim();
      if (!t) return send(res, 400, { error: "token is required" });
      const u = new URL("/api/prescriptions/verify", "http://localhost");
      u.searchParams.set("token", t);
      req.url = u.toString().replace("http://localhost", "");
      return handlePrescriptions(req, res, user);
    }

    // POST /api/prescriptions → crea receta (doctor)
    if (req.method === "POST" && p === "/api/prescriptions") {
      if (!user) return send(res, 401, { error: "Auth requerido" });
      const chk = requireRole(user, "doctor");
      if (!chk.ok) return send(res, 403, { error: chk.error });

      const body = await readJson(req).catch(() => null);
      if (!body) return send(res, 400, { error: "Invalid JSON body" });

      const patientId = body.patient_id || body.patientId;
      if (!patientId) return send(res, 400, { error: "patient_id requerido" });

      // saneo básico de items
      const rawItems = Array.isArray(body.items) ? body.items : [];
      const cleanItems = rawItems
        .map((it) => {
          const drug_code = String(it.drug_code ?? it.code ?? "").trim();
          const name = String(it.name ?? "").trim();
          const q = Number(it.quantity ?? 1);
          const quantity = Number.isFinite(q) && q > 0 ? q : 1;
          const dosage = it.dosage ? String(it.dosage) : null;
          return { drug_code, name, quantity, dosage };
        })
        .filter((i) => i.drug_code && i.name);

      if (!cleanItems.length) return send(res, 400, { error: "items inválidos: cada item requiere 'drug_code' y 'name'" });

      const out = await createPrescription({ doctorId: user.id, patientId, items: cleanItems, notes: body.notes || null });
      if (!out.ok) return sendErr(res, out);

      await logAction(req, user.id, "RX_CREATE", "prescription", out.data.id, { by: user.id });
      return send(res, 201, out.data);
    }

    // GET /api/prescriptions/:id → obtiene una receta (autorización básica)
    const mGetOne = req.method === "GET" && /^\/api\/prescriptions\/([^\/]+)$/.exec(p);
    if (mGetOne) {
      if (!user) return send(res, 401, { error: "Auth requerido" });
      const id = mGetOne[1];
      const rx = await repo.getPrescriptionById(id);
      if (!rx) return send(res, 404, { error: "Prescription not found" });

      const isDoctor = user.role === "doctor" && String(user.id) === String(rx.doctor_id);
      const isPatient = user.role === "patient" && String(user.id) === String(rx.patient_id);
      const isAdmin = user.role === "admin";
      const isPharma = user.role === "pharmacy";
      if (!(isDoctor || isPatient || isAdmin || isPharma)) return send(res, 403, { error: "No autorizado" });

      const items = await repo.getItemsByRx(id);
      const { verify_secret, ...safe } = rx;
      return send(res, 200, { ...safe, items });
    }

    // POST /api/prescriptions/:id/sign → firma (doctor)
    const mSign = req.method === "POST" && /^\/api\/prescriptions\/([^\/]+)\/sign$/.exec(p);
    if (mSign) {
      if (!user) return send(res, 401, { error: "Auth requerido" });
      const id = mSign[1];
      const chk = requireRole(user, "doctor");
      if (!chk.ok) return send(res, 403, { error: chk.error });
      const body = await readJson(req).catch(() => null);
      if (!body || !body.privateKeyPem) return send(res, 400, { error: "privateKeyPem requerido" });

      const out = await signPrescription({ doctorId: user.id, prescriptionId: id, privateKeyPem: body.privateKeyPem });
      if (!out.ok) return sendErr(res, out);
      await logAction(req, user.id, "RX_SIGN", "prescription", id, { by: user.id });
      return send(res, 200, out.data);
    }

    // POST /api/prescriptions/:id/anchor → ancla en blockchain (doctor)
    const mAnchor = req.method === "POST" && /^\/api\/prescriptions\/([^\/]+)\/anchor$/.exec(p);
    if (mAnchor) {
      if (!user) return send(res, 401, { error: "Auth requerido" });
      const id = mAnchor[1];
      const chk = requireRole(user, "doctor");
      if (!chk.ok) return send(res, 403, { error: chk.error });
      const out = await anchorOnChain({ prescriptionId: id, by: user.id });
      if (!out.ok) return sendErr(res, out);
      await logAction(req, user.id, "RX_ANCHOR", "prescription", id, { by: user.id, anchor: out.data });
      return send(res, 200, out.data);
    }

    // GET /api/prescriptions/:id/anchor → info de anclaje
    const mGetAnchor = req.method === "GET" && /^\/api\/prescriptions\/([^\/]+)\/anchor$/.exec(p);
    if (mGetAnchor) {
      if (!user) return send(res, 401, { error: "Auth requerido" });
      const id = mGetAnchor[1];
      const out = await getAnchorInfo({ prescriptionId: id });
      if (!out.ok) return sendErr(res, out);
      return send(res, 200, out.data);
    }

    // GET /api/prescriptions/:id/anchor/verify → re-verifica on-chain
    const mVerifyAnchor = req.method === "GET" && /^\/api\/prescriptions\/([^\/]+)\/anchor\/verify$/.exec(p);
    if (mVerifyAnchor) {
      if (!user) return send(res, 401, { error: "Auth requerido" });
      const id = mVerifyAnchor[1];
      const out = await verifyAnchorOnChain({ prescriptionId: id });
      if (!out.ok) return sendErr(res, out);
      return send(res, 200, out.data);
    }

    // GET /api/prescriptions/:id/qr → genera token de verificación (QR)
    const mQR = req.method === "GET" && /^\/api\/prescriptions\/([^\/]+)\/qr$/.exec(p);
    if (mQR) {
      if (!user) return send(res, 401, { error: "Auth requerido" });
      const id = mQR[1];

      const rx = await repo.getPrescriptionById(id);
      if (!rx) return send(res, 404, { error: "Prescription not found" });

      const isDoctor = user.role === "doctor" && String(user.id) === String(rx.doctor_id);
      const isPatient = user.role === "patient" && String(user.id) === String(rx.patient_id);
      const isAdmin = user.role === "admin";
      if (!(isDoctor || isPatient || isAdmin)) return send(res, 403, { error: "Forbidden" });

      if (rx.status === "DRAFT") return send(res, 400, { error: "Prescription not issued" });

      const token = await buildVerifyToken({ prescriptionId: id, by: user.id });
      await logAction(req, user.id, "RX_QR_TOKEN", "prescription", id, { by: user.id });
      return send(res, 200, { token });
    }

    // POST /api/prescriptions/:id/dispense → dispensar (pharmacy)
    const mDisp = req.method === "POST" && /^\/api\/prescriptions\/([^\/]+)\/dispense$/.exec(p);
    if (mDisp) {
      if (!user) return send(res, 401, { error: "Auth requerido" });
      const id = mDisp[1];
      const chk = requireRole(user, "pharmacy");
      if (!chk.ok) return send(res, 403, { error: chk.error });

      const body = await readJson(req).catch(() => null);
      const out = await dispense({ prescriptionId: id, pharmacyUser: user, body: body || {} });
      if (!out.ok) return sendErr(res, out);

      await logAction(req, user.id, "RX_DISPENSE", "prescription", id, { by: user.id });
      return send(res, 200, out.data);
    }

    return false; // no match
  } catch (err) {
    console.error("[prescriptions] error:", err);
    return send(res, 500, { error: "Internal error" });
  }
}

module.exports = { handlePrescriptions };
