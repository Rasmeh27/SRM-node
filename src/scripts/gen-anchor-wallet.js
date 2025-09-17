// src/scripts/gen-anchor-wallet.js
const { ethers } = require("ethers");

const w = ethers.Wallet.createRandom();
console.log("✅ Wallet de pruebas creada");
console.log("Address:", w.address);
console.log("PrivateKey:", w.privateKey); // ya viene con 0x
console.log("\n— Copia/pega estas líneas en tu .env —");
console.log("ANCHOR_MODE=real");
console.log("SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/8e4d985e778649e391db55ad7dd52065");
console.log(`ANCHOR_PRIVATE_KEY=${w.privateKey}`);
console.log("# ANCHOR_TO=0x000000000000000000000000000000000000dEaD  # opcional");
