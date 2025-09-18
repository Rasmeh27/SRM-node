//Luis Herasme

// src/scripts/gen-keys.js
const { generateKeyPairSync } = require("crypto");
const fs = require("fs");
const path = require("path");

const dir = path.join(process.cwd(), "src", "keys");
fs.mkdirSync(dir, { recursive: true });

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

fs.writeFileSync(path.join(dir, "doctor-demo-private.pem"), privateKey);
fs.writeFileSync(path.join(dir, "doctor-demo-public.pem"), publicKey);

console.log("✅ Keys generated at src/keys/: doctor-demo-private.pem & doctor-demo-public.pem");
