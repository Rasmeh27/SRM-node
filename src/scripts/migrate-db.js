//Luis Herasme

// scripts/migrate-db.js
// Usage: node scripts/migrate-db.js <in.json> <out.json>
const fs = require("fs");
const path = require("path");

const inputPath = process.argv[2] || "db/db.json";
const outputPath = process.argv[3] || "data/srm_db_normalized.json";

function nowISO(){ return new Date().toISOString(); }

// IDs fijos para que coincidan con la colección de Postman
const CODE_TO_ID_DEFAULT = { AMOX500: 101, PARA500: 202, IBU400: 303 };

function main() {
  const raw = fs.readFileSync(inputPath, "utf8");
  const db = JSON.parse(raw);

  // --- Users: asegurar "name"
  const users = (db.users || []).map(u => ({
    ...u,
    name: u.name || u.full_name || u.email || u.id,
  }));
  const userById = Object.fromEntries(users.map(u => [u.id, u]));

  // --- Medications: generar id numérico y conservar code
  const codeToId = { ...CODE_TO_ID_DEFAULT };
  let nextId = 1000;
  const medications = (db.medications || []).map(m => {
    const code = m.drug_code || m.code || m.id || `CODE_${Math.random().toString(36).slice(2,8)}`;
    let id = codeToId[code];
    if (!id) { id = nextId++; codeToId[code] = id; }
    return { id, name: m.name, code };
  });
  const medsById = Object.fromEntries(medications.map(m => [String(m.id), m]));

  // Helper: items por receta (vienen en tabla aparte)
  const itemsByRx = {};
  for (const it of (db.prescription_items || [])) {
    const rxId = it.prescription_id;
    const code = it.drug_code;
    const medId = codeToId[code] || null;
    (itemsByRx[rxId] ||= []).push({
      medication_id: medId,
      dose: it.dosage || it.dose || null,
      frequency: null,
      name: it.name || null,
      code
    });
  }

  // Helper: dispensations por receta (tabla aparte)
  const dispByRx = {};
  for (const d of (db.dispensations || [])) {
    const rxId = d.prescription_id;
    (dispByRx[rxId] ||= []).push({
      idemKey: null,
      at: d.timesstamp || d.timestamp || d.created_at || nowISO(),
      items: (d.items || []).map(di => ({
        medication_id: codeToId[di.drug_code] || null,
        qty: di.quantity
      })),
      location: d.location || null,
      verificationMethod: d.verification_method || null,
      notes: d.notes || null,
      pharmacy_id: d.pharmacy_id || null
    });
  }

  // --- Prescriptions: normalizar campos
  const prescriptions = (db.prescriptions || []).map(p => {
    const signedAt = p.signedAt || p.signed_at || p.signature?.signed_at || null;
    const status = (() => {
      if (p.status === "DISPENSED") return "DISPENSED";
      if (p.status === "EMITTED")  return signedAt ? "SIGNED" : "CREATED";
      return p.status || "CREATED";
    })();

    return {
      id: p.id,
      doctor_id: p.doctor_id,
      patient_id: p.patient_id,
      items: itemsByRx[p.id] || [],                 // embebidos
      notes: p.notes || null,
      status,                                       // CREATED -> SIGNED -> DISPENSED
      createdAt: p.createdAt || p.created_at || nowISO(),
      signedAt,
      dispensedAt: p.dispensedAt || null,
      signature: p.signature?.signature_b64 || p.signature || null,
      cert: p.signature ? {
        subject: p.signature.cert_subject || null,
        serial: p.signature.cert_serial  || null
      } : (p.cert || null),
      hash: p.hash || p.hash_sha256 || null,
      chain: p.chain || null,
      verifyToken: p.verifyToken || null,
      dispensations: dispByRx[p.id] || []
    };
  });

  // Salida
  const out = {
    users,
    medications,
    prescriptions,
    access_grants: db.access_grants || [],
    notifications: db.notifications || [],
    audit_events: db.audit_events || []
  };

  // Validación mínima: medicamentos referenciados existen
  for (const rx of prescriptions) {
    for (const it of rx.items) {
      if (it.medication_id && !medsById[String(it.medication_id)]) {
        console.warn(`WARN: Prescription ${rx.id} item with unknown medication_id ${it.medication_id}`);
      }
    }
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(out, null, 2), "utf8");
  console.log(`✅ Normalized DB written to: ${outputPath}`);
  console.log(`ℹ️  Med IDs:`, medications.map(m => ({ id: m.id, code: m.code, name: m.name })));
}

main();
