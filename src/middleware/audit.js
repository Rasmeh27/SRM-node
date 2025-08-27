const { loadDB, saveDB } = require("../db/storage");

function logAction(req, actorId, action, entityType, entityId, metadata = {}) {
  const db = loadDB();
  db.audit_events.push({
    id: Date.now(),
    actor_id: actorId || null,
    action,
    entity_id: String(entityId),
    metadata: {
      ...metadata,
      ip: req.socket?.remoteAddress || null,
      ua: req.headers["user-agent"] || "",
    },
    created_at: new Date().toISOString(),
  });
  saveDB(db);
}

module.exports = { logAction };
