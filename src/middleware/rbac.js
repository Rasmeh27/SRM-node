// src/middleware/rbac.js
function requireRole(user, role) {
  if (!user) return { ok: false, error: "Auth requerido" };
  if (String(user.role) !== String(role)) return { ok: false, error: `Se requiere rol ${role}` };
  return { ok: true };
}
function requireAnyRole(user, roles = []) {
  if (!user) return { ok: false, error: "Auth requerido" };
  if (!roles.includes(String(user.role))) return { ok: false, error: `Se requiere uno de: ${roles.join(", ")}` };
  return { ok: true };
}

// ➕ NUEVO:
function canViewPatientHistory(user, patientId, db) {
  if (!user) return { ok: false, error: "Auth requerido" };
  if (user.role === "admin") return { ok: true };
  if (user.role === "patient" && String(user.id) === String(patientId)) return { ok: true };
  if (user.role === "doctor") {
    const grants = (db.access_grants || []).filter(g =>
      g.patient_id === patientId &&
      g.grantee_id === user.id &&
      !g.revoked_at &&
      (!g.expires_at || new Date(g.expires_at) > new Date())
    );
    if (grants.length) return { ok: true };
  }
  return { ok: false, error: "No autorizado" };
}

module.exports = { requireRole, requireAnyRole, canViewPatientHistory };
