// src/infra/db.js
const { Pool } = require("pg");

const connStr = process.env.DATABASE_URL;
if (!connStr) {
  console.warn("[db] Falta DATABASE_URL (Supabase).");
}

// Forzar TLS pero sin validar la CA (útil en Supabase/Windows/proxies)
const pool = new Pool({
  connectionString: connStr,
  ssl: { require: true, rejectUnauthorized: false },
  max: 10,                 // recomendable con PgBouncer
  idleTimeoutMillis: 30000,
  allowExitOnIdle: true,
});

async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const dur = Date.now() - start;
  if (dur > 500) console.log(`[db] slow query ${dur}ms: ${text}`);
  return res;
}

module.exports = { pool, query };
