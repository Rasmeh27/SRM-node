// src/routes/prescriptions.routes.js
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
function pathOnly(url) {
  return url.split("?")[0];
}
async function readJson(req, limit = 1e6) {
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

// base64url & HMAC helpers
function b64urlToUtf8(b64url) {
  const b64 =
    b64url.replace(/-/g, "+").replace(/_/g, "/") +
    "===".slice((b64url.length + 3) % 4);
  return Buffer.from(b64, "base64").toString("utf8");
}
function hmacB64url(input, secret) {
  const mac = crypto
    .createHmac("sha256", secret)
    .update(input)
    .digest("base64");
  return mac.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function timingSafeEq(a, b) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

// Extrae el ID de la receta desde el payload del token, aceptando varios alias
function extractRxId(payload) {
  return (
    payload?.prescription_id ||
    payload?.prescriptionId ||
    payload?.rx ||
    payload?.pid ||
    null
  );
}

// ======== main handler ========
async function handlePrescriptions(req, res, user) {
  const p = pathOnly(req.url);
  const url = new URL(req.url, "http://localhost");

  try {
    // ---- GET /api/medications ----
    if (req.method === "GET" && p === "/api/medications") {
      const meds = await listMedications();
      return send(res, 200, meds);
    }

    // ---- GET /api/prescriptions ----
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

    // ───────────────────────────────────────────────────────────────
    //  V E R I F I C A C I Ó N  (antes de /:id para no capturar /verify)
    //  Acepta HMAC (payload.mac) y JWT HS256 (header.payload.sig)
    // ───────────────────────────────────────────────────────────────
    if (req.method === "GET" && p === "/api/prescriptions/verify") {
      let token = url.searchParams.get("token");
      if (!token) return send(res, 400, { error: "token is required" });

      token = token.trim();
      if (token.startsWith("{")) {
        try {
          const j = JSON.parse(token);
          token = j.token || j.t || token;
        } catch {}
      }

      const parts = token.split(".");
      if (parts.length < 2) {
        return send(res, 400, { error: "INVALID_TOKEN_FORMAT" });
      }

      // Intentos con distintas claves y formas
      async function tryVerifyWith(secrets, shape) {
        for (const secret of secrets) {
          if (!secret) continue;

          // Forma JWT: header.payload.sig
          if (shape === "jwt" && parts.length === 3) {
            try {
              const verified = jwt.verify(token, secret, {
                algorithms: ["HS256"],
              });
              return { ok: true, payload: verified };
            } catch {}
            // HMAC manual "header.payload"
            const [hB64, pB64, sig] = parts;
            const mac = hmacB64url(`${hB64}.${pB64}`, secret);
            if (timingSafeEq(sig, mac)) {
              try {
                const payload = JSON.parse(b64urlToUtf8(pB64));
                return { ok: true, payload };
              } catch {}
            }
          }

          // Forma HMAC simple: payloadB64.mac
          // Forma HMAC simple: payloadB64.mac
          if (shape === "raw") {
            const macGiven = parts[parts.length - 1];
            const payloadB64 = parts.slice(0, -1).join(".");
            let payloadObj = null;
            let payloadJson = null;
            try {
              payloadJson = b64urlToUtf8(payloadB64);
              payloadObj = JSON.parse(payloadJson);
            } catch {
              // si no es JSON, igual probamos HMAC sobre el b64
            }

            // Firmas esperadas en base64url (lo que ya tenías)
            const macA = hmacB64url(payloadB64, secret);
            const macB = payloadJson ? hmacB64url(payloadJson, secret) : null;

            // ✅ Compatibilidad con tokens existentes firmados en HEX (como buildVerifyToken)
            const macHexA = crypto
              .createHmac("sha256", secret)
              .update(payloadB64)
              .digest("hex");
            const macHexB = payloadJson
              ? crypto
                  .createHmac("sha256", secret)
                  .update(payloadJson)
                  .digest("hex")
              : null;

            if (
              timingSafeEq(macGiven, macA) ||
              (macB && timingSafeEq(macGiven, macB)) ||
              timingSafeEq(macGiven, macHexA) ||
              (macHexB && timingSafeEq(macGiven, macHexB))
            ) {
              const payload = payloadObj ?? {};
              return { ok: true, payload };
            }
          }
        }
        return { ok: false };
      }

      // Extrae provisionalmente el rxId del payload (si está)
      let provisionalRxId = null;
      if (parts.length === 3) {
        try {
          const pObj = JSON.parse(b64urlToUtf8(parts[1]));
          provisionalRxId = extractRxId(pObj);
        } catch {}
      } else {
        try {
          const pObj = JSON.parse(b64urlToUtf8(parts.slice(0, -1).join(".")));
          provisionalRxId = extractRxId(pObj);
        } catch {}
      }

      // Cargar receta (si hay id) para tomar verify_secret
      let rx = null;
      if (provisionalRxId) {
        rx = await repo.getPrescriptionById(provisionalRxId).catch(() => null);
      }

      const candidates = [
        rx?.verify_secret, // por-receta (preferido)
        process.env.VERIFY_SECRET, // compat global
        process.env.JWT_SECRET, // compat JWT
        "dev-verify-secret", // fallback dev
      ].filter(Boolean);

      let result = { ok: false, payload: null };

      if (parts.length === 3) {
        result = await tryVerifyWith(candidates, "jwt");
        if (!result.ok) result = await tryVerifyWith(candidates, "raw");
      } else {
        result = await tryVerifyWith(candidates, "raw");
      }

      if (!result.ok) {
        return send(res, 401, { error: "INVALID_TOKEN_SIGNATURE" });
      }

      const payload = result.payload || {};
      const rxId = extractRxId(payload) || provisionalRxId;
      if (!rxId) return send(res, 400, { error: "Invalid token payload" });

      // exp (si vino)
      if (payload?.exp && Math.floor(Date.now() / 1000) > Number(payload.exp)) {
        return send(res, 401, { error: "TOKEN_EXPIRED" });
      }

      // Buscar receta real
      rx = await repo.getPrescriptionById(rxId).catch(() => null);
      if (!rx) return send(res, 404, { error: "Prescription not found", rxId });

      const items = await repo.getItemsByRx(rxId);

      const valid = Boolean(rx.signature_b64 && rx.hash_sha256);
      const anchored = Boolean(rx.anchor_txid);

      await logAction(
        req,
        user?.id || null,
        "RX_VERIFY",
        "prescription",
        rx.id,
        { by: user?.id || "public" }
      );

      const { verify_secret, ...safe } = rx;
      return send(res, 200, {
        valid,
        anchored,
        network: rx.anchor_network || null,
        txid: rx.anchor_txid || null,
        prescription: { ...safe, items },
      });
    }

    // ---- POST /api/prescriptions/verify  (body {token}) ----
    if (req.method === "POST" && p === "/api/prescriptions/verify") {
      const body = await readJson(req).catch(() => ({}));
      const t = String(body?.token || body?.t || "").trim();
      if (!t) return send(res, 400, { error: "token is required" });
      // Reusar la lógica GET para mantener un solo camino de verificación
      const u = new URL("/api/prescriptions/verify", "http://localhost");
      u.searchParams.set("token", t);
      req.url = u.toString().replace("http://localhost", "");
      return handlePrescriptions(req, res, user);
    }

    // ---- POST /api/prescriptions (crear) ----
    if (req.method === "POST" && p === "/api/prescriptions") {
      if (!user) return send(res, 401, { error: "Auth requerido" });
      const chk = requireRole(user, "doctor");
      if (!chk.ok) return send(res, 403, { error: chk.error });

      const body = await readJson(req).catch(() => null);
      if (!body) return send(res, 400, { error: "Invalid JSON body" });

      const patientId = body.patient_id || body.patientId;
      if (!patientId) return send(res, 400, { error: "patient_id requerido" });

      // saneo de items
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

      if (cleanItems.length === 0) {
        return send(res, 400, {
          error: "items inválidos: cada item requiere 'drug_code' y 'name'",
        });
      }

      const out = await createPrescription({
        doctorId: user.id,
        patientId,
        items: cleanItems,
        notes: body.notes || null,
      });
      if (!out.ok) return sendErr(res, out);

      await logAction(req, user.id, "RX_CREATE", "prescription", out.data.id, {
        by: user.id,
      });
      return send(res, 201, out.data);
    }

    // ---- GET /api/prescriptions/:id ----
    const mGetOne =
      req.method === "GET" && /^\/api\/prescriptions\/([^\/]+)$/.exec(p);
    if (mGetOne) {
      if (!user) return send(res, 401, { error: "Auth requerido" });
      const id = mGetOne[1];
      const rx = await repo.getPrescriptionById(id);
      if (!rx) return send(res, 404, { error: "Prescription not found" });

      // Autorización simple
      const isDoctor =
        user.role === "doctor" && String(user.id) === String(rx.doctor_id);
      const isPatient =
        user.role === "patient" && String(user.id) === String(rx.patient_id);
      const isAdmin = user.role === "admin";
      const isPharma = user.role === "pharmacy";
      if (!(isDoctor || isPatient || isAdmin || isPharma)) {
        return send(res, 403, { error: "No autorizado" });
      }

      const items = await repo.getItemsByRx(id);
      const { verify_secret, ...safe } = rx;
      return send(res, 200, { ...safe, items });
    }

    // ---- POST /api/prescriptions/:id/sign ----
    const mSign =
      req.method === "POST" && /^\/api\/prescriptions\/([^\/]+)\/sign$/.exec(p);
    if (mSign) {
      if (!user) return send(res, 401, { error: "Auth requerido" });
      const id = mSign[1];
      const chk = requireRole(user, "doctor");
      if (!chk.ok) return send(res, 403, { error: chk.error });
      const body = await readJson(req).catch(() => null);
      if (!body || !body.privateKeyPem)
        return send(res, 400, { error: "privateKeyPem requerido" });
      const out = await signPrescription({
        doctorId: user.id,
        prescriptionId: id,
        privateKeyPem: body.privateKeyPem,
      });
      if (!out.ok) return sendErr(res, out);
      await logAction(req, user.id, "RX_SIGN", "prescription", id, {
        by: user.id,
      });
      return send(res, 200, out.data);
    }

    // ---- POST /api/prescriptions/:id/anchor ----
    const mAnchor =
      req.method === "POST" &&
      /^\/api\/prescriptions\/([^\/]+)\/anchor$/.exec(p);
    if (mAnchor) {
      if (!user) return send(res, 401, { error: "Auth requerido" });
      const id = mAnchor[1];
      const chk = requireRole(user, "doctor");
      if (!chk.ok) return send(res, 403, { error: chk.error });
      const out = await anchorOnChain({ prescriptionId: id, by: user.id });
      if (!out.ok) return sendErr(res, out);
      await logAction(req, user.id, "RX_ANCHOR", "prescription", id, {
        by: user.id,
        anchor: out.data,
      });
      return send(res, 200, out.data);
    }

    // ---- GET /api/prescriptions/:id/anchor ----
    const mGetAnchor =
      req.method === "GET" &&
      /^\/api\/prescriptions\/([^\/]+)\/anchor$/.exec(p);
    if (mGetAnchor) {
      if (!user) return send(res, 401, { error: "Auth requerido" });
      const id = mGetAnchor[1];
      const out = await getAnchorInfo({ prescriptionId: id });
      if (!out.ok) return sendErr(res, out);
      return send(res, 200, out.data);
    }

    // ---- GET /api/prescriptions/:id/anchor/verify ----
    const mVerifyAnchor =
      req.method === "GET" &&
      /^\/api\/prescriptions\/([^\/]+)\/anchor\/verify$/.exec(p);
    if (mVerifyAnchor) {
      if (!user) return send(res, 401, { error: "Auth requerido" });
      const id = mVerifyAnchor[1];
      const out = await verifyAnchorOnChain({ prescriptionId: id });
      if (!out.ok) return sendErr(res, out);
      return send(res, 200, out.data);
    }

    // ---- GET /api/prescriptions/:id/qr ----
    const mQR =
      req.method === "GET" && /^\/api\/prescriptions\/([^\/]+)\/qr$/.exec(p);
    if (mQR) {
      if (!user) return send(res, 401, { error: "Auth requerido" });
      const id = mQR[1];

      // Cargar receta y validar propiedad/rol
      const rx = await repo.getPrescriptionById(id);
      if (!rx) return send(res, 404, { error: "Prescription not found" });

      const isDoctor =
        user.role === "doctor" && String(user.id) === String(rx.doctor_id);
      const isPatient =
        user.role === "patient" && String(user.id) === String(rx.patient_id);
      const isAdmin = user.role === "admin";
      if (!(isDoctor || isPatient || isAdmin)) {
        return send(res, 403, { error: "Forbidden" });
      }

      // (opcional) bloquear si está en DRAFT
      if (rx.status === "DRAFT") {
        return send(res, 400, { error: "Prescription not issued" });
      }

      // Generamos el token con buildVerifyToken (usa verify_secret por-receta)
      const token = await buildVerifyToken({
        prescriptionId: id,
        by: user.id,
      });

      await logAction(req, user.id, "RX_QR_TOKEN", "prescription", id, {
        by: user.id,
      });
      return send(res, 200, { token });
    }

    // ---- POST /api/prescriptions/:id/dispense ----
    const mDisp =
      req.method === "POST" &&
      /^\/api\/prescriptions\/([^\/]+)\/dispense$/.exec(p);
    if (mDisp) {
      if (!user) return send(res, 401, { error: "Auth requerido" });
      const id = mDisp[1];
      const chk = requireRole(user, "pharmacy");
      if (!chk.ok) return send(res, 403, { error: chk.error });
      const body = await readJson(req).catch(() => null);
      const out = await dispense({
        prescriptionId: id,
        pharmacyUser: user,
        body: body || {},
      });
      if (!out.ok) return sendErr(res, out);
      await logAction(req, user.id, "RX_DISPENSE", "prescription", id, {
        by: user.id,
      });
      return send(res, 200, out.data);
    }

    return false; // no match
  } catch (err) {
    console.error("[prescriptions] error:", err);
    return send(res, 500, { error: "Internal error" });
  }
}

module.exports = { handlePrescriptions };
