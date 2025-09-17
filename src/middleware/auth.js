// src/middleware/auth.js
const { supabaseAdmin } = require("../infra/supabase");

// helpers
function pathOnly(url) {
  return (url || "").split("?")[0];
}
function isPublic(req) {
  const p = pathOnly(req.url);
  return (
    p === "/api/prescriptions/verify" &&
    (req.method === "GET" || req.method === "POST")
  );
}

/**
 * Autenticación: Authorization: Bearer <token de Supabase>
 * Fallback dev: x-user-id / x-role
 * Devuelve objeto user: { id, role, fullname }
 * - Para /api/prescriptions/verify (GET/POST) se permite acceso público.
 */
async function authUser(req) {
  // ✅ Bypass público para farmacia: verificación de recetas
  if (isPublic(req)) {
    return { id: null, role: "public", fullname: "Public" };
  }

  try {
    const auth = req.headers["authorization"];
    if (auth?.startsWith("Bearer ")) {
      const token = auth.slice("Bearer ".length);
      const { data, error } = await supabaseAdmin.auth.getUser(token);
      if (!error && data?.user) {
        const { data: prof } = await supabaseAdmin
          .from("profiles")
          .select("id, role, fullname")
          .eq("id", data.user.id)
          .single();
        if (prof) return prof;
      }
    }
  } catch (e) {
    console.warn("[auth] token inválido", e?.message);
  }

  // Fallback dev
  const uid = req.headers["x-user-id"];
  const role = req.headers["x-role"];
  if (uid && role) {
    return {
      id: uid,
      role,
      fullname: (role || "USER").toUpperCase() + " Dev",
    };
  }
  return null;
}

module.exports = { authUser };
