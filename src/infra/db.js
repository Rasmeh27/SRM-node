//Luis Herasme

// src/infra/db.js
// Conexión a Postgres (Supabase) y helper de consulta con log si la query es lenta.

const { Pool } = require("pg");

const connStr = process.env.DATABASE_URL;
if (!connStr) {
  console.warn("[db] Falta DATABASE_URL (Supabase).");
}

// Pool de conexiones (TLS requerido; sin validar CA para compatibilidad)
const pool = new Pool({
  connectionString: connStr,
  ssl: { require: true, rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  allowExitOnIdle: true,
});

// Ejecuta una query y registra si tarda > 500ms.
async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const dur = Date.now() - start;
  if (dur > 500) console.log(`[db] slow query ${dur}ms: ${text}`);
  return res;
}

module.exports = { pool, query };
