//Luis Herasme


// Utilidad para anclar un hash en una red EVM (ej. Sepolia) y verificar la transacción.

const { ethers } = require("ethers");

// Devuelve provider JSON-RPC desde env.
function getProvider() {
  const url = process.env.ANCHOR_RPC_URL || process.env.SEPOLIA_RPC_URL;
  if (!url) throw new Error("Falta ANCHOR_RPC_URL o SEPOLIA_RPC_URL");
  return new ethers.providers.JsonRpcProvider(url);
}

// Devuelve wallet desde ANCHOR_PRIVATE_KEY (conectada al provider).
function getWallet() {
  let pk = process.env.ANCHOR_PRIVATE_KEY;
  if (!pk) throw new Error("Falta ANCHOR_PRIVATE_KEY");
  if (!pk.startsWith("0x")) pk = "0x" + pk;
  return new ethers.Wallet(pk, getProvider());
}

// Codifica "SRM|sha256|<hash>|rx:<rxId>" a hex 0x...
function encodeData({ hash, rxId }) {
  const payload = `SRM|sha256|${hash}|rx:${rxId}`;
  return "0x" + Buffer.from(payload, "utf8").toString("hex");
}

// Envía la tx con el hash y devuelve { network, txid, blockNumber }.
async function anchorHash({ hash, rxId }) {
  const wallet = getWallet();
  const provider = wallet.provider;
  const to = process.env.ANCHOR_TO || wallet.address;
  const data = encodeData({ hash, rxId });

  const fee = await provider.getFeeData();
  const maxPriorityFeePerGas = fee.maxPriorityFeePerGas || ethers.utils.parseUnits("1", "gwei");
  const maxFeePerGas = fee.maxFeePerGas || ethers.utils.parseUnits("30", "gwei");

  let gasLimit;
  try {
    gasLimit = await wallet.estimateGas({ to, value: 0, data, maxPriorityFeePerGas, maxFeePerGas });
  } catch {
    gasLimit = ethers.BigNumber.from(80000);
  }

  const bal = await wallet.getBalance();
  const costoMax = maxFeePerGas.mul(gasLimit);
  if (bal.lt(costoMax)) throw new Error("Fondos insuficientes para fees");

  const tx = await wallet.sendTransaction({ to, value: 0, data, gasLimit, maxFeePerGas, maxPriorityFeePerGas });
  const receipt = await tx.wait(1);

  const net = await provider.getNetwork();
  const network =
    process.env.ANCHOR_NETWORK ||
    (net.chainId === 11155111 ? "sepolia" : net.chainId === 80002 ? "polygon-amoy" : net.chainId === 84532 ? "base-sepolia" : String(net.chainId));

  return { network, txid: tx.hash, blockNumber: receipt.blockNumber };
}

// Devuelve { tx, receipt } para un txid dado.
async function getTxAndReceipt(txid) {
  const provider = getProvider();
  const tx = await provider.getTransaction(txid);
  const receipt = await provider.getTransactionReceipt(txid);
  return { tx, receipt };
}

// Convierte data hex a texto UTF-8;
function decodeTxDataHexToUtf8(dataHex) {
  if (!dataHex) return null;
  try { return Buffer.from(dataHex.replace(/^0x/, ""), "hex").toString("utf8"); }
  catch { return null; }
}

module.exports = { anchorHash, getTxAndReceipt, decodeTxDataHexToUtf8 };
