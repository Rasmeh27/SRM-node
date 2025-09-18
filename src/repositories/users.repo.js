//Luis herasme

// src/repositories/users.repo.js
const { query } = require("../infra/db");

// ---- Lecturas básicas
async function getProfile(id) {
  const r = await query(`select id, role, fullname, document_id, license_number, created_at
                         from public.profiles where id=$1`, [id]);
  return r.rows[0] || null;
}

async function listDoctors() {
  const r = await query(`select id, fullname, license_number, created_at
                         from public.profiles where role='doctor' order by fullname asc`);
  return r.rows;
}

async function listPatients({ doctorId } = {}) {
  if (doctorId) {
    const r = await query(
      `select p.id, p.fullname, p.document_id, dp.assigned_at
         from public.doctor_patients dp
         join public.profiles p on p.id = dp.patient_id
        where dp.doctor_id = $1
        order by p.fullname asc`,
      [doctorId]
    );
    return r.rows;
  }
  const r = await query(`select id, fullname, document_id, created_at
                         from public.profiles where role='patient' order by fullname asc`);
  return r.rows;
}

// ---- Asignaciones
async function assignPatientToDoctor({ doctorId, patientId }) {
  // valida roles
  const d = await query(`select id from public.profiles where id=$1 and role='doctor'`, [doctorId]);
  if (d.rowCount === 0) throw new Error("Doctor no existe");
  const p = await query(`select id from public.profiles where id=$1 and role='patient'`, [patientId]);
  if (p.rowCount === 0) throw new Error("Paciente no existe");

  // inserta (enforce 1 doctor/paciente por unique(patient_id))
  await query(
    `insert into public.doctor_patients (doctor_id, patient_id)
     values ($1,$2)
     on conflict (patient_id) do update set doctor_id=excluded.doctor_id, assigned_at=now()`,
    [doctorId, patientId]
  );
}

async function unassignPatientFromDoctor({ doctorId, patientId }) {
  await query(
    `delete from public.doctor_patients where doctor_id=$1 and patient_id=$2`,
    [doctorId, patientId]
  );
}

async function getDoctorForPatient(patientId) {
  const r = await query(
    `select d.id, d.fullname, d.license_number, dp.assigned_at
       from public.doctor_patients dp
       join public.profiles d on d.id = dp.doctor_id
      where dp.patient_id = $1`,
    [patientId]
  );
  return r.rows[0] || null;
}

module.exports = {
  getProfile,
  listDoctors,
  listPatients,
  assignPatientToDoctor,
  unassignPatientFromDoctor,
  getDoctorForPatient,
};
