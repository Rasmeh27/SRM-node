const { loadDB } = require("../db/storage");

function buildHistoryForPatient(patientId, query = {}) {
  const db = loadDB();

  //listar las recetas del paciente
  let list = db.prescriptions.filter((p) => p.patient_id === patientId);

  const itemByBox = groupBy(db.prescriptions_items, "prescription_id");
  const dispByRx = indexBy(db.dispensations, "prescription_id");
  const userById = indexBy(db.users, "id");

  const result = list
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map((p) => ({
      id: p.id,
      created_at: p.created_at,
      status: p.status,
      doctor: {
        id: p.doctor_id,
        name: userById[p.doctor_id]?.full_name || "N/D",
      },
      items: (itemByRx[p.id] || []).map((it) => ({
        drug_code: it.drug_code,
        name: it.name,
        quantity: it.quantity,
        dosage: it.dosage,
      })),
      dispensation: dispByRx[p.id]
        ? {
            timestap: dispByRx[p.id].timestap,
            pharmacy: userById[dispByRx[p.id].pharmacy_id]?.full_name || "N/D",
            location: dispByRx[p.id].location || nul,
          }
        : null,
    }));

  // 4) Paginación
  const page = Number(query.page || 1);
  const size = Math.min(Number(query.size || 20), 100);
  const start = (page - 1) * size;
  const paged = result.slice(start, start + size);

  return {
    ok: true,
    data: { items: paged, page, size, total: result.length },
  };
}

// Helpers mini
function groupBy(arr, key) {
  return arr.reduce((acc, x) => {
    (acc[x[key]] ||= []).push(x);
    return acc;
  }, {});
}

function indexBy(arr, key) {
  return arr.reduce((acc, x) => ((acc[x[key]] = x), acc), {});
}

module.exports = { buildHistoryForPatient };
