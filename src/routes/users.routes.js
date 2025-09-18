//Xavier Fernandez

// src/routes/users.routes.js
// Endpoints de usuarios: listar doctores/pacientes y asignar/desasignar paciente a doctor.

const {
  listDoctors,
  listPatients,
  assignPatient,
  unassignPatient,
  getPatientDoctor,
} = require("../services/users.service");

// Respuesta JSON simple
function send(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
  return true;
}

// Solo path (sin query)
function pathOnly(url) { return url.split("?")[0]; }

// Lee body JSON con límite
async function readJson(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", ch => { data += ch; if (data.length > limit) reject(new Error("Body too large")); });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error("Invalid JSON")); } });
  });
}

// Endpoints:
// GET  /api/doctors
// GET  /api/patients[?doctorId=UUID]
// GET  /api/patients/:patientId/doctor
// POST /api/doctors/:doctorId/patients/:patientId   (asignar)
// DELETE /api/doctors/:doctorId/patients/:patientId (desasignar)

async function handleUsers(req, res, user) {
  const p = pathOnly(req.url);
  const url = new URL(req.url, "http://localhost");

  // Lista doctores
  if (req.method === "GET" && p === "/api/doctors") {
    const out = await listDoctors();
    return send(res, 200, out.data);
  }

  // Lista pacientes (opcional filtrar por doctorId)
  if (req.method === "GET" && p === "/api/patients") {
    const doctorId = url.searchParams.get("doctorId");
    const out = await listPatients({ requester: user, doctorId });
    if (!out.ok) return send(res, out.status || 400, { error: out.error });
    return send(res, 200, out.data);
  }

  // Doctor asignado de un paciente
  const mGetDoc = req.method === "GET" && /^\/api\/patients\/([^\/]+)\/doctor$/.exec(p);
  if (mGetDoc) {
    const patientId = mGetDoc[1];
    const out = await getPatientDoctor({ requester: user, patientId });
    if (!out.ok) return send(res, out.status || 400, { error: out.error });
    return send(res, 200, out.data || {});
  }

  // Asignar paciente a doctor
  const mAssign = req.method === "POST" && /^\/api\/doctors\/([^\/]+)\/patients\/([^\/]+)$/.exec(p);
  if (mAssign) {
    const doctorId = mAssign[1];
    const patientId = mAssign[2];
    const out = await assignPatient({ requester: user, doctorId, patientId });
    if (!out.ok) return send(res, out.status || 400, { error: out.error });
    return send(res, 200, out.data);
  }

  // Quitar asignación paciente-doctor
  const mUnassign = req.method === "DELETE" && /^\/api\/doctors\/([^\/]+)\/patients\/([^\/]+)$/.exec(p);
  if (mUnassign) {
    const doctorId = mUnassign[1];
    const patientId = mUnassign[2];
    const out = await unassignPatient({ requester: user, doctorId, patientId });
    if (!out.ok) return send(res, out.status || 400, { error: out.error });
    return send(res, 200, out.data);
  }

  return false; // no coincide
}

module.exports = { handleUsers };
