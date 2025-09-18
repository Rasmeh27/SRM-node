//Luis Herasme

// src/services/prescriptions.service.js
// Lógica de recetas: crear, firmar, token QR/HMAC, anclar en blockchain, dispensar y listar.

const crypto = require("crypto");
const repo = require("../repositories/prescriptions.repo");
const { signRSASha256 } = require("../crypto/sign");
const jwt = require("jsonwebtoken");

const ANCHOR_MODE = (process.env.ANCHOR_MODE || "").toLowerCase();

// utils básicos
const nowISO = () => new Date().toISOString();
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
const hmacHex = (data, secret) => crypto.createHmac("sha256", secret).update(data).digest("hex");

// Catálogo de medicamentos
async function listMedications() { return await repo.listMedications(); }
// Busca receta o lanza error
async function getByIdOrThrow(id) {
  const rx = await repo.getPrescriptionById(id);
  if (!rx) throw new Error("Prescription not found");
  return rx;
}

// Crea una receta (sanea items y guarda verify_secret por receta)
async function createPrescription({ doctorId, patientId, items, notes }) {
  if (!doctorId) return { ok: false, status: 400, error: "doctorId requerido" };
  if (!patientId) return { ok: false, status: 400, error: "patientId requerido" };
  if (!Array.isArray(items) || items.length === 0) return { ok: false, status: 400, error: "Faltan items de la receta" };

  const cleanItems = items
    .map((it) => {
      const drug_code = String(it.drug_code ?? it.code ?? "").trim();
      const name = String(it.name ?? "").trim();
      const q = Number(it.quantity ?? 1);
      const quantity = Number.isFinite(q) && q > 0 ? q : 1;
      const dosage = it.dosage != null ? String(it.dosage) : null;
      return { drug_code, name, quantity, dosage };
    })
    .filter((i) => i.drug_code && i.name);
  if (!cleanItems.length) return { ok: false, status: 400, error: "Cada item requiere 'drug_code' y 'name'" };

  const id = `rx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const verifySecret = crypto.randomBytes(32).toString("hex");

  try {
    await repo.insertPrescriptionWithItems({ id, doctorId, patientId, items: cleanItems, notes, verifySecret });
    const rx = await repo.getPrescriptionById(id);
    const { verify_secret, ...safe } = rx || {};
    return { ok: true, data: safe };
  } catch (e) {
    return { ok: false, status: 400, error: e.message };
  }
}

// Crea JSON canónico para firmar/hashear
async function canonicalizeForSign(rx) {
  const items = await repo.getItemsByRx(rx.id);
  return JSON.stringify({ id: rx.id, patient_id: rx.patient_id, doctor_id: rx.doctor_id, items, created_at: rx.created_at, notes: rx.notes || null });
}

// Firma una receta (RSA-SHA256) y guarda hash + firma
async function signPrescription({ doctorId, prescriptionId, privateKeyPem }) {
  const rx = await repo.getPrescriptionById(prescriptionId);
  if (!rx) return { ok: false, status: 404, error: "Prescription not found" };
  if (String(rx.doctor_id) !== String(doctorId)) return { ok: false, status: 403, error: "Solo el doctor emisor puede firmar" };

  const payload = await canonicalizeForSign(rx);
  let signature_b64, hash;
  try {
    signature_b64 = signRSASha256(privateKeyPem, payload);
    hash = sha256(payload);
  } catch {
    return { ok: false, status: 400, error: "privateKeyPem inválido o mal formateado" };
  }
  await repo.updateSignature({ id: rx.id, hash, signature_b64 });
  const updated = await repo.getPrescriptionById(rx.id);
  return { ok: true, data: { id: updated.id, status: updated.status, hash, signed_at: updated.signed_at, signature_b64 } };
}

// Genera token (b64url.payload + HMAC hex) para QR/NFC usando secreto por receta
async function buildVerifyToken({ prescriptionId }) {
  const rx = await repo.getPrescriptionById(prescriptionId);
  if (!rx) throw new Error("Prescription not found");
  const secret = rx.verify_secret || process.env.VERIFY_SECRET || "dev-verify-secret";
  const payload = { pid: prescriptionId, ts: Date.now() };
  const data = JSON.stringify(payload);
  const mac = hmacHex(data, secret);
  return b64url(data) + "." + mac;
}

// Verifica token escaneado (HMAC con secreto por receta)
async function verifyScanToken({ token }) {
  if (!token || typeof token !== "string" || token.indexOf(".") < 0) return { ok: false, status: 400, error: "Token inválido" };
  const [b64, mac] = token.split(".");
  let payload;
  try {
    const std = b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4);
    payload = JSON.parse(Buffer.from(std, "base64").toString("utf8"));
  } catch {
    return { ok: false, status: 400, error: "Token corrupto" };
  }
  const rx = await repo.getPrescriptionById(payload.pid);
  if (!rx) return { ok: false, status: 404, error: "Prescription not found" };
  const secret = rx.verify_secret || process.env.VERIFY_SECRET || "dev-verify-secret";
  const expect = hmacHex(JSON.stringify(payload), secret);
  if (mac !== expect) return { ok: false, status: 400, error: "Token no válido" };
  return { ok: true, data: { prescription_id: payload.pid, issuedAt: new Date(payload.ts).toISOString() } };
}

// Ancla hash en blockchain (real o demo) y guarda txid/red
async function anchorOnChain({ prescriptionId }) {
  const rx = await repo.getPrescriptionById(prescriptionId);
  if (!rx) return { ok: false, status: 404, error: "Prescription not found" };
  if (!rx.hash_sha256) return { ok: false, status: 400, error: "Debe firmarse antes de anclar" };

  if (ANCHOR_MODE === "real") {
    try {
      const { anchorHash } = require("../blockchain/anchor");
      const info = await anchorHash({ hash: rx.hash_sha256, rxId: rx.id });
      await repo.updateAnchor({ id: rx.id, network: info.network, txid: info.txid, blockNumber: info.blockNumber });
      return { ok: true, data: info };
    } catch (e) {
      return { ok: false, status: 500, error: `Error anclando en blockchain: ${e.message}` };
    }
  }

  const demo = { network: "placeholder", txid: "demo-" + Date.now(), anchored_at: nowISO() };
  await repo.updateAnchor({ id: rx.id, network: demo.network, txid: demo.txid, blockNumber: null });
  return { ok: true, data: demo };
}

// Obtiene info de anclaje guardada
async function getAnchorInfo({ prescriptionId }) {
  const rx = await getByIdOrThrow(prescriptionId);
  if (!rx.anchor_txid && !rx.anchor_network) return { ok: false, status: 404, error: "No hay anclaje para esta receta" };
  return { ok: true, data: { network: rx.anchor_network || null, txid: rx.anchor_txid || null, blockNumber: rx.anchor_block || null } };
}

// Re-verifica en cadena que el payload coincida con el hash de la receta
async function verifyAnchorOnChain({ prescriptionId }) {
  const rx = await getByIdOrThrow(prescriptionId);
  if (!rx.anchor_txid) return { ok: false, status: 404, error: "Esta receta aún no tiene txid" };

  try {
    const { getTxAndReceipt, decodeTxDataHexToUtf8 } = require("../blockchain/anchor");
    const { tx, receipt } = await getTxAndReceipt(rx.anchor_txid);
    const payload = decodeTxDataHexToUtf8(tx?.data);
    const expected = `SRM|sha256|${rx.hash_sha256}|rx:${rx.id}`;
    return { ok: true, data: { matches: payload === expected, payload, expected, status: receipt?.status ?? null, blockNumber: receipt?.blockNumber ?? null, txid: rx.anchor_txid, network: rx.anchor_network || null } };
  } catch (e) {
    return { ok: false, status: 500, error: `No se pudo verificar on-chain: ${e.message}` };
  }
}

// Marca receta como dispensada por farmacia y devuelve resumen
async function dispense({ prescriptionId, pharmacyUser, body = {} }) {
  if (!pharmacyUser || pharmacyUser.role !== "pharmacy") return { ok: false, status: 403, error: "Solo farmacias pueden dispensar" };
  try {
    await repo.insertDispensation({ id: prescriptionId, pharmacyId: pharmacyUser.id, location: body.location || pharmacyUser.fullname || "Farmacia", notes: body.notes || null });
    const rx = await repo.getPrescriptionById(prescriptionId);
    const items = await repo.getItemsByRx(prescriptionId);
    return {
      ok: true,
      data: {
        id: rx.id,
        status: rx.status,
        dispensedAt: rx.dispensed_at,
        dispensedBy: rx.dispensed_by,
        dispensation: {
          id: `disp-*`,
          timestamp: rx.dispensed_at,
          location: body.location || "Farmacia",
          items: items.map(i => ({ drug_code: i.drug_code, quantity: i.quantity })),
          verificationMethod: "QR",
        },
      },
    };
  } catch (e) {
    return { ok: false, status: 400, error: e.message };
  }
}

// Lista recetas visibles según requester y filtros
async function listPrescriptions({ requester, doctorId, patientId }) {
  try {
    const data = await repo.listByRequester({ requester, doctorId, patientId });
    return { ok: true, data };
  } catch (e) {
    return { ok: false, status: 400, error: e.message };
  }
}

module.exports = {
  listMedications,
  createPrescription,
  signPrescription,
  buildVerifyToken,
  verifyScanToken,
  anchorOnChain,
  getAnchorInfo,
  verifyAnchorOnChain,
  dispense,
  listPrescriptions,
};
