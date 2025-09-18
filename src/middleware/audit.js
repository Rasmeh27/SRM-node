// Xavier Fernandez

// src/middleware/audit.js
// Guarda eventos de auditoría en la tabla public.audit_events.

const { query } = require("../infra/db");

// Inserta un registro de acción (quién, qué, sobre qué, y meta opcional).
async function logAction(req, actorId, action, entityType, entityId, meta) {
  try {
    await query(
      `insert into public.audit_events (actor_id, action, entity_type, entity_id, meta, ts)
       values ($1,$2,$3,$4,$5, now())`,
      [actorId || null, action, entityType, entityId, meta ? JSON.stringify(meta) : null]
    );
  } catch (e) {
    console.warn("[audit] error:", e?.message);
  }
}

module.exports = { logAction };
