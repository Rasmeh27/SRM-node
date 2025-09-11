// src/db/storage.js (robusto)
const fs = require("fs");
const path = require("path");

// Prioridad: env -> ./db/db.json -> (fallback) junto al archivo
const CANDIDATES = [
  process.env.DB_PATH,
  path.join(process.cwd(), "src", "db", "db.json"),
  path.join(__dirname, "db.json"),
].filter(Boolean);

let DB_PATH = CANDIDATES.find((p) => {
  try { return fs.existsSync(p); } catch { return false; }
}) || CANDIDATES[0];

function ensureDir() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadDB() {
  ensureDir();
  if (!fs.existsSync(DB_PATH)) {
    const empty = { users: [], patients: [], doctors: [], prescriptions: [], prescription_items: [], dispensations: [], access_grants: [], audit_events: [], medications: [] };
    fs.writeFileSync(DB_PATH, JSON.stringify(empty, null, 2), "utf8");
  }
  const raw = fs.readFileSync(DB_PATH, "utf8");
  return JSON.parse(raw);
}

function saveDB(db) {
  ensureDir();
  const tmp = DB_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), "utf8");
  fs.renameSync(tmp, DB_PATH);
  return true;
}

function getDBPath() { return DB_PATH; }

module.exports = { loadDB, saveDB, DB_PATH, getDBPath };
