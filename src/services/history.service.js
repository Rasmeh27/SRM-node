const { loadDB } = require("../db/storage");

function buildHistoryForPatient(patientId, query = {}) {
  const db = loadDB();

  //listar las recetas del paciente
  let list = db.prescriptions.filter((p) => p.patient_id === patientId);

  const itemByBox = groupBy(db.prescription_items, "prescription_id");
  const dispByRx = indexBy(db.dispensations, "prescription_id");
  const userById = indexBy(db.users, "id");

  const result = list
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map((p) => ({
      id: p.id,
      createdAt: p.created_at,
      status: p.status,
      doctor: {
        id: p.doctor_id,
        name: userById[p.doctor_id]?.full_name || "N/D",
      },
      items: (itemByBox[p.id] || []).map((it) => ({
        drug_code: it.drug_code,
        name: it.name,
        quantity: it.quantity,
        dosage: it.dosage,
      })),
      dispensation: dispByRx[p.id]
        ? {
            timestamp: dispByRx[p.id].timestamp,
            pharmacyId: dispByRx[p.id].pharmacy_id,
          }
        : null,
    }));

  return { ok: true, data: result };
}

function groupBy(arr = [], key) {
  return arr.reduce((acc, it) => {
    (acc[it[key]] = acc[it[key]] || []).push(it);
    return acc;
  }, {});
}

function indexBy(arr = [], key) {
  return arr.reduce((acc, it) => ((acc[it[key]] = it), acc), {});
}

module.exports = { buildHistoryForPatient };
