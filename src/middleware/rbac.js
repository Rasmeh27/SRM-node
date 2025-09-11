function requireRole(user, roleNeeded) {
  if (!user) return { ok: false, error: "Unauthenticated" };
  if (user.role !== roleNeeded) {
    return { ok: false, error: `Forbidden: requires role ${roleNeeded}` };
  }
  return { ok: true };
}

function requireAnyRole(user, roles) {
  if (!user) return { ok: false, error: "Unauthenticated" };
  if (!roles.includes(user.role)) {
    return {
      ok: false,
      error: `Forbidden: requires one of [${roles.join(", ")}]`,
    };
  }
  return { ok: true };
}

function canViewPatientHistory(user, patientId, db) {
  if (!user) return { ok: false, error: "Unauthenticated" };

  if (user.role === "patient") {
    return user.id === patientId ? { ok: true } : { ok: false, error: "Forbidden" };
  }

  if (user.role === "doctor") {
    // Debe existir un grant activo del paciente al doctor
    const grants = db.access_grants || [];
    const hasGrant = grants.some(
      (g) =>
        g.patient_id === patientId &&
        g.grantee_id === user.id &&
        g.grantee_type === "doctor" &&
        !g.revoked_at &&
        new Date(g.expires_at) > new Date()
    );
    return hasGrant ? { ok: true } : { ok: false, error: "Forbidden: missing active grant" };
  }

  // Regulador / Aseguradora solo si hay grant explícito
  if (user.role === "regulator" || user.role === "insurer") {
    const grants = db.access_grants || [];
    const hasGrant = grants.some(
      (g) =>
        g.patient_id === patientId &&
        g.grantee_id === user.id &&
        g.grantee_type === user.role &&
        !g.revoked_at &&
        new Date(g.expires_at) > new Date()
    );
    return hasGrant ? { ok: true } : { ok: false, error: "Forbidden: missing active grant" };
  }

  return { ok: false, error: "Forbidden" };
}

module.exports = { requireRole, requireAnyRole, canViewPatientHistory };
