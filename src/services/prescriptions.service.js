// src/services/prescriptions.service.js (integrado)
const crypto = require("crypto");
const { loadDB, saveDB } = require("../db/storage");
const { signRSASha256 } = require("../crypto/sign");

// ---------- utils ----------
const nowISO = () => new Date().toISOString();
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const base64url = (buf) => Buffer.from(buf).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

// Token QR/NFC (HMAC sobre payload)
const VERIFY_SECRET = process.env.VERIFY_SECRET || "dev-verify-secret";
function hmac(dataObj) {
  const data = JSON.stringify(dataObj);
  return crypto.createHmac("sha256", VERIFY_SECRET).update(data).digest("hex");
}

// ---------- helpers ----------
function ensureUser(db, id, role) {
  const u = (db.users || []).find((x) => x.id === id && (!role || x.role === role));
  if (!u) throw new Error(`Usuario ${id} con rol ${role} no existe`);
  return u;
}
function listMedications() {
  const db = loadDB();
  return db.medications || [];
}
function getByIdOrThrow(db, id) {
  const x = (db.prescriptions || []).find((p) => p.id === id);
  if (!x) throw new Error("Prescription not found");
  return x;
}
function itemsForRx(db, rxId) {
  return (db.prescription_items || []).filter((it) => String(it.prescription_id) === String(rxId));
}
function putItems(db, rxId, items) {
  // items: [{drug_code, name, quantity, dosage}]  ó  [{medication_id, dose, frequency, qty}]
  const normalized = items.map((it, i) => {
    if (it.drug_code) {
      return {
        id: `item-${rxId}-${i+1}`,
        prescription_id: rxId,
        drug_code: String(it.drug_code),
        name: it.name || null,
        quantity: Number(it.quantity || 1),
        dosage: it.dosage || it.dose || null,
      };
    }
    // forma alternativa basada en catálogo
    const med = (loadDB().medications || []).find((m) => String(m.id) === String(it.medication_id));
    return {
      id: `item-${rxId}-${i+1}`,
      prescription_id: rxId,
      drug_code: med ? (med.code || med.id) : String(it.medication_id),
      name: med ? (med.name || med.title) : (it.name || null),
      quantity: Number(it.qty || it.quantity || 1),
      dosage: it.dose || it.dosage || null,
    };
  });

  // limpiar previos e insertar
  db.prescription_items = (db.prescription_items || []).filter((x) => x.prescription_id !== rxId);
  db.prescription_items.push(...normalized);
}

// ---------- emisión ----------
function createPrescription({ doctorId, patientId, items, notes }) {
  const db = loadDB();
  ensureUser(db, doctorId, "doctor");
  ensureUser(db, patientId, "patient");
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, status: 400, error: "Faltan items de la receta" };
  }

  const id = `rx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const rx = {
    id,
    patient_id: patientId,
    doctor_id: doctorId,
    status: "DRAFT",
    pdf_url: null,
    hash_sha256: null,
    created_at: nowISO(),
    dispensed_by: null,
  };

  db.prescriptions = db.prescriptions || [];
  db.prescriptions.push(rx);
  putItems(db, id, items);
  if (!db.dispensations) db.dispensations = [];
  if (!db.audit_events) db.audit_events = [];
  saveDB(db);

  return { ok: true, data: rx };
}

// Crea representación canónica para firmar/hashear
function canonicalizeForSign(db, rx) {
  const items = itemsForRx(db, rx.id).map((it) => ({
    drug_code: it.drug_code, name: it.name, quantity: it.quantity, dosage: it.dosage
  }));
  return JSON.stringify({
    id: rx.id,
    patient_id: rx.patient_id,
    doctor_id: rx.doctor_id,
    items,
    created_at: rx.created_at,
    notes: rx.notes || null,
  });
}

function signPrescription({ doctorId, prescriptionId, privateKeyPem }) {
  const db = loadDB();
  const rx = getByIdOrThrow(db, prescriptionId);
  if (rx.doctor_id !== doctorId) {
    return { ok: false, status: 403, error: "Solo el doctor emisor puede firmar" };
  }
  const payload = canonicalizeForSign(db, rx);
  const signature_b64 = signRSASha256(privateKeyPem, payload);
  const hash = sha256(payload);

  rx.status = "ISSUED";
  rx.hash_sha256 = hash;
  rx.signed_at = nowISO();
  rx.signature_b64 = signature_b64;

  saveDB(db);
  return { ok: true, data: { id: rx.id, status: rx.status, hash: hash, signed_at: rx.signed_at, signature_b64 } };
}

// ---------- verificación (QR/NFC) ----------
function buildVerifyToken({ prescriptionId, by }) {
  const payload = { pid: prescriptionId, ts: Date.now() };
  const mac = hmac(payload);
  const token = base64url(JSON.stringify(payload)) + "." + mac;
  return token;
}
function verifyScanToken({ token }) {
  if (!token || typeof token !== "string" || token.indexOf(".") < 0) {
    return { ok: false, status: 400, error: "Token inválido" };
  }
  const [b64, mac] = token.split(".");
  let payload;
  try { payload = JSON.parse(Buffer.from(b64, "base64").toString("utf8")); }
  catch { return { ok: false, status: 400, error: "Token corrupto" }; }
  const expect = hmac(payload);
  if (mac !== expect) return { ok: false, status: 400, error: "Token no válido" };
  return { ok: true, data: { prescription_id: payload.pid, issuedAt: new Date(payload.ts).toISOString() } };
}

// ---------- anchor (placeholder) ----------
function anchorOnChain({ prescriptionId, by }) {
  const db = loadDB();
  const rx = getByIdOrThrow(db, prescriptionId);
  if (!rx.hash_sha256) {
    return { ok: false, status: 400, error: "Debe firmarse antes de anclar" };
  }
  const anchor = {
    network: "placeholder",
    txid: "demo-" + Date.now(),
    anchored_at: nowISO(),
  };
  rx.anchor = anchor;
  saveDB(db);
  return { ok: true, data: anchor };
}

// ---------- dispensación ----------
function dispense({ prescriptionId, pharmacyUser, body = {} }) {
  const db = loadDB();
  const rx = getByIdOrThrow(db, prescriptionId);

  if (rx.status !== "ISSUED") {
    return { ok: false, status: 400, error: "Solo recetas emitidas pueden dispensarse" };
  }
  if (!pharmacyUser || pharmacyUser.role !== "pharmacy") {
    return { ok: false, status: 403, error: "Solo farmacias pueden dispensar" };
  }

  rx.status = "DISPENSED";
  rx.dispensed_by = pharmacyUser.id;
  rx.dispensed_at = nowISO();

  const items = itemsForRx(db, rx.id).map((it) => ({ drug_code: it.drug_code, quantity: it.quantity }));
  const disp = {
    id: "disp-" + Date.now(),
    prescription_id: rx.id,
    pharmacy_id: pharmacyUser.id,
    timestamp: nowISO(),
    location: body.location || pharmacyUser.fullname || "Farmacia",
    items,
    verification_method: "QR",
    notes: body.notes || null,
  };
  db.dispensations.push(disp);
  saveDB(db);

  return {
    ok: true,
    data: {
      id: rx.id,
      status: rx.status,
      dispensedAt: rx.dispensed_at,
      dispensedBy: rx.dispensed_by,
      dispensation: {
        id: disp.id,
        timestamp: disp.timestamp,
        location: disp.location,
        items: disp.items,
        verificationMethod: disp.verification_method,
      },
    },
  };
}

function listPrescriptions({ requester, doctorId, patientId }) {
  const db = loadDB();
  let list = db.prescriptions || [];
  if (doctorId) list = list.filter((p) => String(p.doctor_id) === String(doctorId));
  if (patientId) list = list.filter((p) => String(p.patient_id) === String(patientId));
  // Visibilidad mínima
  if (requester.role === "doctor") {
    list = list.filter((p) => p.doctor_id === requester.id);
  } else if (requester.role === "patient") {
    list = list.filter((p) => p.patient_id === requester.id);
  }
  // map items
  const itemsBy = Object.groupBy
    ? Object.groupBy(loadDB().prescription_items || [], (it) => it.prescription_id)
    : (loadDB().prescription_items || []).reduce((acc, it) => ((acc[it.prescription_id] = acc[it.prescription_id] || []).push(it), acc), {});
  return {
    ok: true,
    data: list.map((p) => ({
      ...p,
      items: (itemsBy[p.id] || []).map((it) => ({ drug_code: it.drug_code, name: it.name, quantity: it.quantity, dosage: it.dosage })),
    })),
  };
}

module.exports = {
  listMedications,
  createPrescription,
  signPrescription,
  buildVerifyToken,
  verifyScanToken,
  anchorOnChain,
  dispense,
  listPrescriptions,
};
