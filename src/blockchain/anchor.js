// src/blockchain/anchor.js
const { ethers } = require("ethers");

function getProvider() {
  const url = process.env.ANCHOR_RPC_URL || process.env.SEPOLIA_RPC_URL;
  if (!url) throw new Error("Falta ANCHOR_RPC_URL o SEPOLIA_RPC_URL");
  return new ethers.providers.JsonRpcProvider(url);
}
function getWallet() {
  let pk = process.env.ANCHOR_PRIVATE_KEY;
  if (!pk) throw new Error("Falta ANCHOR_PRIVATE_KEY");
  if (!pk.startsWith("0x")) pk = "0x" + pk;
  return new ethers.Wallet(pk, getProvider());
}
function encodeData({ hash, rxId }) {
  const payload = `SRM|sha256|${hash}|rx:${rxId}`;
  return "0x" + Buffer.from(payload, "utf8").toString("hex");
}

async function anchorHash({ hash, rxId }) {
  const wallet = getWallet();
  const provider = wallet.provider;
  const to = process.env.ANCHOR_TO || wallet.address; // por defecto self-send
  const data = encodeData({ hash, rxId });

  // Fees EIP-1559 con fallback
  const fee = await provider.getFeeData();
  const maxPriorityFeePerGas = fee.maxPriorityFeePerGas || ethers.utils.parseUnits("1", "gwei");
  const maxFeePerGas = fee.maxFeePerGas || ethers.utils.parseUnits("30", "gwei");

  // Estimación de gas con fallback
  let gasLimit;
  try {
    gasLimit = await wallet.estimateGas({ to, value: 0, data, maxPriorityFeePerGas, maxFeePerGas });
  } catch {
    gasLimit = ethers.BigNumber.from(80000);
  }

  // Chequeo de fondos explícito
  const bal = await wallet.getBalance();
  const costoMax = maxFeePerGas.mul(gasLimit);
  if (bal.lt(costoMax)) {
    throw new Error(`Fondos insuficientes. Balance=${ethers.utils.formatEther(bal)} ETH, costo~=${ethers.utils.formatEther(costoMax)} ETH`);
  }

  // Enviar tx y esperar 1 confirmación
  const tx = await wallet.sendTransaction({ to, value: 0, data, gasLimit, maxFeePerGas, maxPriorityFeePerGas });
  const receipt = await tx.wait(1);

  const net = await provider.getNetwork();
  const network = process.env.ANCHOR_NETWORK || (
    net.chainId === 11155111 ? "sepolia" :
    net.chainId === 80002 ? "polygon-amoy" :
    net.chainId === 84532 ? "base-sepolia" :
    String(net.chainId)
  );

  return { network, txid: tx.hash, blockNumber: receipt.blockNumber };
}

// Utilidades para verificación
async function getTxAndReceipt(txid) {
  const provider = getProvider();
  const tx = await provider.getTransaction(txid);
  const receipt = await provider.getTransactionReceipt(txid);
  return { tx, receipt };
}
function decodeTxDataHexToUtf8(dataHex) {
  if (!dataHex) return null;
  try { return Buffer.from(dataHex.replace(/^0x/, ""), "hex").toString("utf8"); }
  catch { return null; }
}

module.exports = { anchorHash, getTxAndReceipt, decodeTxDataHexToUtf8 };
