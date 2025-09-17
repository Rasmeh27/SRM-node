// src/routes/auth.routes.js
const { supabaseAdmin, supabaseAnon } = require("../infra/supabase");
const { assignPatientToDoctor } = require("../repositories/users.repo"); // usamos repo directo

function send(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
  return true;
}
function pathOnly(url) { return url.split("?")[0]; }
async function readJson(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", ch => { data += ch; if (data.length > limit) reject(new Error("Body too large")); });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error("Invalid JSON")); } });
  });
}

async function handleAuth(req, res, user) {
  const p = pathOnly(req.url);

  // --- DOCTOR ---
  if (req.method === "POST" && p === "/api/auth/register-doctor") {
    const b = await readJson(req).catch(() => null);
    if (!b?.email || !b?.password || !b?.fullname || !b?.license_number) {
      return send(res, 400, { error: "Campos: email, password, fullname, license_number" });
    }
    const { data: signup, error: e1 } = await supabaseAdmin.auth.admin.createUser({
      email: b.email, password: b.password, email_confirm: true
    });
    if (e1) return send(res, 400, { error: e1.message });
    const uid = signup.user.id;
    const { error: e2 } = await supabaseAdmin.from("profiles").insert([
      { id: uid, role: "doctor", fullname: b.fullname, license_number: b.license_number }
    ]);
    if (e2) return send(res, 400, { error: e2.message });
    return send(res, 201, { user_id: uid });
  }

  // --- PACIENTE ---
  if (req.method === "POST" && p === "/api/auth/register-patient") {
    const b = await readJson(req).catch(() => null);
    if (!b?.email || !b?.password || !b?.fullname || !b?.document_id) {
      return send(res, 400, { error: "Campos: email, password, fullname, document_id" });
    }
    const { data: signup, error: e1 } = await supabaseAdmin.auth.admin.createUser({
      email: b.email, password: b.password, email_confirm: true
    });
    if (e1) return send(res, 400, { error: e1.message });
    const uid = signup.user.id;
    const { error: e2 } = await supabaseAdmin.from("profiles").insert([
      { id: uid, role: "patient", fullname: b.fullname, document_id: b.document_id }
    ]);
    if (e2) return send(res, 400, { error: e2.message });

    // Asignar doctor si se envía
    if (b.doctor_id) {
      try {
        await assignPatientToDoctor({ doctorId: b.doctor_id, patientId: uid });
      } catch (e) {
        return send(res, 201, { user_id: uid, warn: `Paciente creado, pero no se pudo asignar doctor: ${e.message}` });
      }
    }

    return send(res, 201, { user_id: uid });
  }

  // --- FARMACIA ---  (💡 ESTO ESTABA FUERA; AHORA DENTRO DE handleAuth)
  if (req.method === "POST" && p === "/api/auth/register-pharmacy") {
    const b = await readJson(req).catch(() => null);
    if (!b?.email || !b?.password || !b?.fullname) {
      return send(res, 400, { error: "Campos: email, password, fullname" });
    }

    const { data: signup, error: e1 } = await supabaseAdmin.auth.admin.createUser({
      email: b.email, password: b.password, email_confirm: true,
    });
    if (e1) return send(res, 400, { error: e1.message });

    const uid = signup.user.id;
    const { error: e2 } = await supabaseAdmin.from("profiles").insert([
      { id: uid, role: "pharmacy", fullname: b.fullname }
      // Si luego agregas columnas como trade_name/phone, agrégalas aquí y en la tabla
    ]);
    if (e2) return send(res, 400, { error: e2.message });

    return send(res, 201, { user_id: uid });
  }

  // --- LOGIN ---
  if (req.method === "POST" && p === "/api/auth/login") {
    const b = await readJson(req).catch(() => null);
    if (!b?.email || !b?.password) return send(res, 400, { error: "email y password requeridos" });
    const { data, error } = await supabaseAnon.auth.signInWithPassword({
      email: b.email, password: b.password
    });
    if (error) return send(res, 400, { error: error.message });

    const { data: prof } = await supabaseAdmin
      .from("profiles").select("id, role, fullname").eq("id", data.user.id).single();

    return send(res, 200, {
      access_token: data.session?.access_token,
      token_type: "bearer",
      user: { id: data.user.id, role: prof?.role, fullname: prof?.fullname }
    });
  }

  // si ninguna ruta coincidió
  return false;
}

module.exports = { handleAuth };
