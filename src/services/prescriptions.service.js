const { loadDB, saveDB } = require("../db/storage");

function dispense({ prescriptionId, pharmacyUser }) {
  const db = loadDB();

  //Buscar la receta
  const rx = db.prescriptions.find((p) => p.id === prescriptionId);
  if (!rx) {
    return { ok: false, status: 404, error: "Prescription not found" };
  }

  //Verificar el estado
  if (rx.status !== "ISSUED") {
    return {
      ok: false,
      status: 400,
      error: "Prescription is not in ISSUED state",
    };
  }

  //Revisar que no haya sido dispensada
  const already = db.dispensations.find(
    (d) => d.prescription_id === prescriptionId
  );
  if (already) {
    return { ok: false, status: 400, error: "Prescription already dispensed" };
  }

  //dispensar la receta
  const disp = {
    id: `disp-${Date.now()}`,
    prescription_id: prescriptionId,
    pharmacy_id: pharmacyUser.id,
    timesstamp: new Date().toISOString(),
    location: pharmacyUser.location || null,
    items: pharmacyUser.location || null,
    items: pharmacyUser.items || [],
    verification_method: pharmacyUser.verificationMethod || "UNKOWN",
    notes: pharmacyUser.notes || null,
  };
  db.dispensations.push(disp);

  rx.status = "DISPENSED";
  rx.dispensed_at = disp.timestamp;
  rx.dispensed_by = pharmacyUser.id;

  saveDB(db);

  return {
    ok: true,
    data: {
      id: rx.id,
      status: rx.status,
      dispensedAt: rx.dispensed_at, // 👈 añade esto
      dispensedBy: rx.dispensed_by,
      dispensation: {
        // 👈 opcional: devolver lo creado
        id: disp.id,
        timestamp: disp.timestamp,
        location: disp.location,
        items: disp.items,
        verificationMethod: disp.verification_method,
      },
    },
  };
}

module.exports = { dispense };
