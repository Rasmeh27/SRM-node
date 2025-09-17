// src/repositories/prescriptions.repo.js
const { query, pool } = require("../infra/db");

// Crea receta + items en transacción (incluye verify_secret)
async function insertPrescriptionWithItems({ id, doctorId, patientId, items, notes, verifySecret }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Inserta la receta
    await client.query(
      `insert into public.prescriptions
       (id, patient_id, doctor_id, status, created_at, notes, verify_secret)
       values ($1,$2,$3,'DRAFT', now(), $4, $5)`,
      [id, patientId, doctorId, notes || null, verifySecret || null]
    );

    // Inserta los ítems SIN la columna id (la genera Postgres)
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      await client.query(
        `insert into public.prescription_items
         (prescription_id, drug_code, name, quantity, dosage)
         values ($1,$2,$3,$4,$5)`,
        [
          id,
          String(it.drug_code),
          it.name || null,
          Number(it.quantity || 1),
          it.dosage || it.dose || null,
        ]
      );
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function getPrescriptionById(id) {
  // devolvemos * para que el servicio pueda acceder a verify_secret cuando lo necesite
  const rx = await query(`select * from public.prescriptions where id=$1`, [id]);
  return rx.rows[0] || null;
}

async function getItemsByRx(id) {
  const r = await query(
    `select drug_code, name, quantity, dosage
     from public.prescription_items
     where prescription_id=$1
     order by id asc`,
    [id]
  );
  return r.rows;
}

async function updateSignature({ id, hash, signature_b64 }) {
  await query(
    `update public.prescriptions
     set status='ISSUED', hash_sha256=$2, signature_b64=$3, signed_at=now()
     where id=$1`,
    [id, hash, signature_b64]
  );
}

async function updateAnchor({ id, network, txid, blockNumber }) {
  await query(
    `update public.prescriptions
     set anchor_network=$2, anchor_txid=$3, anchor_block=$4
     where id=$1`,
    [id, network, txid, blockNumber ?? null]
  );
}

async function insertDispensation({ id, pharmacyId, location, notes }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const upd = await client.query(
      `update public.prescriptions
       set status='DISPENSED', dispensed_by=$2, dispensed_at=now()
       where id=$1 and status='ISSUED'`,
      [id, pharmacyId]
    );
    if (upd.rowCount === 0) throw new Error("Solo recetas ISSUED pueden dispensarse");

    await client.query(
      `insert into public.dispensations
       (id, prescription_id, pharmacy_id, location, notes, verification_method)
       values ($1,$2,$3,$4,$5,'QR')`,
      [`disp-${Date.now()}`, id, pharmacyId, location || 'Farmacia', notes || null]
    );

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// Listado para UI: EXCLUYE verify_secret
async function listByRequester({ requester, doctorId, patientId }) {
  let base = `
    select
      p.id, p.patient_id, p.doctor_id, p.status, p.pdf_url,
      p.hash_sha256, p.signature_b64, p.signed_at, p.created_at,
      p.dispensed_by, p.dispensed_at, p.notes,
      p.anchor_network, p.anchor_txid, p.anchor_block
    from public.prescriptions p
    where 1=1`;
  const params = [];
  if (doctorId) { params.push(doctorId); base += ` and p.doctor_id=$${params.length}`; }
  if (patientId){ params.push(patientId); base += ` and p.patient_id=$${params.length}`; }
  if (requester?.role === 'doctor') {
    params.push(requester.id); base += ` and p.doctor_id=$${params.length}`;
  } else if (requester?.role === 'patient') {
    params.push(requester.id); base += ` and p.patient_id=$${params.length}`;
  }
  base += ` order by p.created_at desc limit 200`;

  const pres = await query(base, params);
  const ids = pres.rows.map(r => r.id);
  if (!ids.length) return [];

  const items = await query(
    `select prescription_id, drug_code, name, quantity, dosage
     from public.prescription_items
     where prescription_id = any($1)`,
    [ids]
  );
  const byRx = {};
  for (const it of items.rows) {
    (byRx[it.prescription_id] = byRx[it.prescription_id] || []).push({
      drug_code: it.drug_code, name: it.name, quantity: it.quantity, dosage: it.dosage
    });
  }
  return pres.rows.map(p => ({ ...p, items: byRx[p.id] || [] }));
}

async function listMedications() {
  const r = await query(`select id, code, name from public.medications order by name asc`);
  return r.rows;
}

module.exports = {
  insertPrescriptionWithItems,
  getPrescriptionById,
  getItemsByRx,
  updateSignature,
  updateAnchor,
  insertDispensation,
  listByRequester,
  listMedications,
};
