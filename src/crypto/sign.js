//Luis Herasme


// src/crypto/sign.js
// Utilidades de firma/verificación RSA-SHA256 con claves en PEM (PKCS#1 o PKCS#8).

const crypto = require("crypto");

// Normaliza un PEM: corrige \r y '\n' escapados; asegura salto final.
function normalizePem(pem) {
  if (typeof pem !== "string") throw new Error("privateKeyPem debe ser string");
  pem = pem.replace(/\\r/g, "\n").replace(/\r/g, "");
  pem = pem.replace(/\\n/g, "\n");
  pem = pem.trim();
  if (!pem.endsWith("\n")) pem += "\n";
  return pem;
}

// Convierte el PEM a objeto PrivateKey (detecta PKCS#1 vs PKCS#8).
function toPrivateKey(pem) {
  const norm = normalizePem(pem);
  const type = norm.includes("BEGIN RSA PRIVATE KEY") ? "pkcs1" : "pkcs8";
  return crypto.createPrivateKey({ key: norm, format: "pem", type });
}

// Firma texto con RSA-SHA256. Devuelve firma en base64.
function signRSASha256(privateKeyPem, text) {
  const keyObj = toPrivateKey(privateKeyPem);
  const sig = crypto.sign("sha256", Buffer.from(text, "utf8"), keyObj);
  return sig.toString("base64");
}

// Verifica firma RSA-SHA256 (true/false).
function verifyRSASha256(publicKeyPem, text, signatureB64) {
  const pub = crypto.createPublicKey(publicKeyPem);
  return crypto.verify("sha256", Buffer.from(text, "utf8"), pub, Buffer.from(signatureB64, "base64"));
}

module.exports = { signRSASha256, verifyRSASha256 };
