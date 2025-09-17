// src/services/users.service.js
const repo = require("../repositories/users.repo");

// Helper RBAC simple
function mustBeAdminOrSameDoctor(reqUser, doctorId) {
  if (!reqUser) return { ok: false, status: 401, error: "Auth requerido" };
  if (reqUser.role === "admin") return { ok: true };
  if (reqUser.role === "doctor" && String(reqUser.id) === String(doctorId)) return { ok: true };
  return { ok: false, status: 403, error: "No autorizado" };
}

async function listDoctors() {
  const rows = await repo.listDoctors();
  return { ok: true, data: rows };
}

async function listPatients({ requester, doctorId }) {
  // si se filtra por doctor, verificar permisos
  if (doctorId) {
    const chk = mustBeAdminOrSameDoctor(requester, doctorId);
    if (!chk.ok) return chk;
  }
  const rows = await repo.listPatients({ doctorId });
  return { ok: true, data: rows };
}

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

async function getPatientDoctor({ requester, patientId }) {
  // el propio paciente, su doctor; o el doctor/admin
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
