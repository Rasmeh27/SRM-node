// src/crypto/sign.js
const crypto = require("crypto");

/** Normaliza PEM: quita \r, convierte '\n' literales a saltos reales, asegura fin de línea. */
function normalizePem(pem) {
  if (typeof pem !== "string") throw new Error("privateKeyPem debe ser string");
  // si vino JSON-escapado con \\n, pásalo a saltos reales
  pem = pem.replace(/\\r/g, "\n").replace(/\r/g, "");   // CR de Windows y escapes
  pem = pem.replace(/\\n/g, "\n");                      // '\n' literales -> newline real
  pem = pem.trim();
  if (!pem.endsWith("\n")) pem += "\n";
  return pem;
}

/** Crea objeto PrivateKey soportando PKCS#8 (BEGIN PRIVATE KEY) y PKCS#1 (BEGIN RSA PRIVATE KEY). */
function toPrivateKey(pem) {
  const norm = normalizePem(pem);
  const type = norm.includes("BEGIN RSA PRIVATE KEY") ? "pkcs1" : "pkcs8";
  return crypto.createPrivateKey({ key: norm, format: "pem", type });
}

/** Firma SHA256 con clave RSA (OpenSSL 3 friendly). Devuelve base64. */
function signRSASha256(privateKeyPem, text) {
  const keyObj = toPrivateKey(privateKeyPem);
  const sig = crypto.sign("sha256", Buffer.from(text, "utf8"), keyObj);
  return sig.toString("base64");
}

/** Verificación opcional. */
function verifyRSASha256(publicKeyPem, text, signatureB64) {
  const pub = crypto.createPublicKey(publicKeyPem);
  return crypto.verify("sha256", Buffer.from(text, "utf8"), pub, Buffer.from(signatureB64, "base64"));
}

module.exports = { signRSASha256, verifyRSASha256 };
