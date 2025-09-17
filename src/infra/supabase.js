// src/infra/supabase.js
const { createClient } = require("@supabase/supabase-js");

const url  = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anon) {
  console.warn("[supabase] faltan SUPABASE_URL / SUPABASE_ANON_KEY");
}

const supabaseAnon  = createClient(url, anon,   { auth: { persistSession: false } });
const supabaseAdmin = createClient(url, service || anon, { auth: { persistSession: false } });

module.exports = { supabaseAnon, supabaseAdmin };
