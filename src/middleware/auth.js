const { loadDB } = require("../db/storage");

function authenticate(req) {
  const userId = req.headers["x-user-id"];
  const role = req.headers["x-role"];

  if (!userId || !role) {
    return { ok: false, error: "Missing headers: x-user-id and x-role" };
  }

  const db = loadDB();
  const user = db.users.find((u) => u.id === userId);

  if (!user) {
    return { ok: false, error: "User not found" };
  }

  if (user.role !== role) {
    return {
      ok: false,
      error: `Role mismatch. Expected ${user.role}, got ${role}`,
    };
  }

  return {
    ok: true,
    user: { id: user.id, role: user.role, fullname: user.full_name },
  };
}

module.exports = { authenticate };
