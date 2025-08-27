const fs = require("fs");
const path = require("path");
const DB_PATH = path.join(__dirname, "db.json");

//funcion para leer la base de datos o el archivo json
function loadDB() {
  const raw = fs.readFileSync(DB_PATH, "utf8");
  return JSON.parse(raw);
}

//funcion para escribir en la base de datos o el archivo json
function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

module.exports = { loadDB, saveDB, DB_PATH };
