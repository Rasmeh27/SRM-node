//Xavier Fernandez y Luis Herasme

// src/middleware/auth.js
// Middleware de autenticación con Supabase. Permite acceso público a /api/prescriptions/verify.

const { supabaseAdmin } = require("../infra/supabase");

// Devuelve solo el path (sin querystring)
function pathOnly(url) {
  return (url || "").split("?")[0];
}

// Rutas públicas permitidas (GET/POST /api/prescriptions/verify)
function isPublic(req) {
  const p = pathOnly(req.url);
  return (
    p === "/api/prescriptions/verify" &&
    (req.method === "GET" || req.method === "POST")
  );
}

/**
 * Lee el usuario desde Authorization: Bearer <token Supabase>.
 * Si es público, retorna user "public".
 * Fallback para dev: x-user-id y x-role.
 */
async function authUser(req) {
  // Bypass público (farmacia verifica receta sin login)
  if (isPublic(req)) {
    return { id: null, role: "public", fullname: "Public" };
  }

  // Token de Supabase
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
        if (prof) return prof; // { id, role, fullname }
      }
    }
  } catch (e) {
    console.warn("[auth] token inválido", e?.message);
  }

  // Fallback dev (headers)
  const uid = req.headers["x-user-id"];
  const role = req.headers["x-role"];
  if (uid && role) {
    return { id: uid, role, fullname: (role || "USER").toUpperCase() + " Dev" };
  }

  // No autenticado
  return null;
}

module.exports = { authUser };
