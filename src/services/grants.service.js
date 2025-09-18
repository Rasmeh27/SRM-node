//Xavier Fernandez

// src/services/grants.service.js
// Servicio de grants: crear, revocar y listar accesos a historial del paciente.

const { loadDB, saveDB } = require("../db/storage");

// Crea un grant (paciente -> doctor) con expiración opcional.
function createGrant({ patientId, granteeId, expiresAt }) {
  const db = loadDB();

  // Debe existir y ser doctor
  const grantee = db.users.find((u) => u.id === granteeId);
  if (!grantee) return { ok: false, status: 404, error: "Grantee not found" };
  if (grantee.role !== "doctor") return { ok: false, status: 400, error: "Only doctors can be granted access" };

  const id = "grant-" + Date.now();
  const grant = {
    id,
    patient_id: patientId,
    grantee_id: granteeId,
    grantee_type: "doctor",
    created_at: new Date().toISOString(),
    expires_at: expiresAt || new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(), // default 30 días
    revoked_at: null,
  };

  db.access_grants = db.access_grants || [];
  db.access_grants.push(grant);
  saveDB(db);
  return { ok: true, data: grant };
}

// Marca un grant como revocado.
function revokeGrant({ patientId, grantId }) {
  const db = loadDB();
  const grant = (db.access_grants || []).find((g) => g.id === grantId && g.patient_id === patientId);
  if (!grant) return { ok: false, status: 404, error: "Grant not found" };
  if (grant.revoked_at) return { ok: false, status: 400, error: "Grant already revoked" };

  grant.revoked_at = new Date().toISOString();
  saveDB(db);
  return { ok: true, data: grant };
}

// Lista todos los grants del paciente.
function listMyGrants(patientId) {
  const db = loadDB();
  const list = (db.access_grants || []).filter((g) => g.patient_id === patientId);
  return { ok: true, data: list };
}

module.exports = { createGrant, revokeGrant, listMyGrants };
