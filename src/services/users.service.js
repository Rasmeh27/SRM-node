//Xavier Fernandez

// src/services/users.service.js
// Servicio de usuarios: listar doctores/pacientes y asignar/desasignar relación doctor–paciente.

const repo = require("../repositories/users.repo");

// RBAC simple: debe ser admin o el mismo doctor dueño del id
function mustBeAdminOrSameDoctor(reqUser, doctorId) {
  if (!reqUser) return { ok: false, status: 401, error: "Auth requerido" };
  if (reqUser.role === "admin") return { ok: true };
  if (reqUser.role === "doctor" && String(reqUser.id) === String(doctorId)) return { ok: true };
  return { ok: false, status: 403, error: "No autorizado" };
}

// Devuelve lista de doctores
async function listDoctors() {
  const rows = await repo.listDoctors();
  return { ok: true, data: rows };
}

// Lista pacientes, opcionalmente filtrando por doctor (con permiso)
async function listPatients({ requester, doctorId }) {
  if (doctorId) {
    const chk = mustBeAdminOrSameDoctor(requester, doctorId);
    if (!chk.ok) return chk;
  }
  const rows = await repo.listPatients({ doctorId });
  return { ok: true, data: rows };
}

// Asigna un paciente a un doctor (admin o el mismo doctor)
async function assignPatient({ requester, doctorId, patientId }) {
  const chk = mustBeAdminOrSameDoctor(requester, doctorId);
  if (!chk.ok) return chk;
  try {
    await repo.assignPatientToDoctor({ doctorId, patientId });
    const doc = await repo.getDoctorForPatient(patientId);
    return { ok: true, data: { patientId, doctor: doc } };
  } catch (e) {
    return { ok: false, status: 400, error: e.message };
  }
}

// Quita la asignación doctor–paciente
async function unassignPatient({ requester, doctorId, patientId }) {
  const chk = mustBeAdminOrSameDoctor(requester, doctorId);
  if (!chk.ok) return chk;
  try {
    await repo.unassignPatientFromDoctor({ doctorId, patientId });
    return { ok: true, data: { unassigned: true, patientId, doctorId } };
  } catch (e) {
    return { ok: false, status: 400, error: e.message };
  }
}

// Devuelve el doctor asignado a un paciente (admin, el propio paciente o un doctor)
async function getPatientDoctor({ requester, patientId }) {
  if (!requester) return { ok: false, status: 401, error: "Auth requerido" };
  if (
    requester.role !== "admin" &&
    !(requester.role === "patient" && requester.id === patientId) &&
    requester.role !== "doctor"
  ) {
    return { ok: false, status: 403, error: "No autorizado" };
  }
  const doc = await repo.getDoctorForPatient(patientId);
  return { ok: true, data: doc };
}

module.exports = {
  listDoctors,
  listPatients,
  assignPatient,
  unassignPatient,
  getPatientDoctor,
};
