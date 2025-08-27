// src/middleware/rbac.js

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

module.exports = { requireRole, requireAnyRole };
