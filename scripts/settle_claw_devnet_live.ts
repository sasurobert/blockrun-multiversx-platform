import fs from "fs";
import path from "path";
import { Address, AddressComputer, Transaction, TransactionComputer } from "@multiversx/sdk-core";
import { UserSigner } from "@multiversx/sdk-wallet";
import { ApiNetworkProvider } from "@multiversx/sdk-network-providers";

const DEVNET_API = process.env.MULTIVERSX_API_URL || "https://devnet-api.multiversx.com";
const USDC_TOKEN = process.env.USDC_TOKEN_IDENTIFIER || "USDC-350c4e";
const USDC_TOKEN_HEX = Buffer.from(USDC_TOKEN).toString("hex");

async function waitForTx(provider: ApiNetworkProvider, txHash: string, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const tx = await provider.getTransaction(txHash);
      if (tx.status.isExecuted() || tx.status.isSuccessful()) {
        return tx;
      }
      if (tx.status.isFailed() || tx.status.isInvalid()) {
        throw new Error(`Transaction ${txHash} failed with status: ${tx.status.status}`);
      }
    } catch (err: any) {
      if (err.message?.includes("failed")) throw err;
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  throw new Error(`Timeout waiting for transaction ${txHash}`);
}

export async function runClawLiveSettlement() {
  console.log(`============================================================`);
  console.log(`   Executing Live Devnet Relayed V3 Settlement for ClawRouter`);
  console.log(`============================================================`);

  const provider = new ApiNetworkProvider(DEVNET_API, { clientName: "claw-live-settler" });
  const walletsDir = path.resolve(process.cwd(), "wallets");

  // 1. Load Agent Signer
  const agentPem = fs.readFileSync(path.join(walletsDir, "agent.pem"), "utf-8");
  const agentSigner = UserSigner.fromPem(agentPem);
  const agentAddress = agentSigner.getAddress().bech32();
  const agentAddr = Address.newFromBech32(agentAddress);

  const computer = new AddressComputer();
  const shard = computer.getShardOfAddress(agentAddr);

  // 2. Load Co-sharded Relayer Signer
  const relayerPem = fs.readFileSync(path.join(walletsDir, `relayer_shard${shard}.pem`), "utf-8");
  const relayerSigner = UserSigner.fromPem(relayerPem);
  const relayerAddress = relayerSigner.getAddress().bech32();
  const relayerAddr = Address.newFromBech32(relayerAddress);

  // 3. Merchant Destination
  const merchantPem = fs.readFileSync(path.join(walletsDir, "merchant.pem"), "utf-8");
  const merchantAddress = UserSigner.fromPem(merchantPem).getAddress().bech32();
  const merchantAddr = Address.newFromBech32(merchantAddress);

  console.log(`Agent (Payer):     ${agentAddress} (Shard ${shard})`);
  console.log(`Relayer (Sponsor): ${relayerAddress} (Shard ${shard})`);
  console.log(`Merchant (Payee):  ${merchantAddress}`);
  console.log(`Token:             ${USDC_TOKEN}`);

  // Fetch Nonces
  const agentAccount = await provider.getAccount({ bech32: () => agentAddress });
  const relayerAccount = await provider.getAccount({ bech32: () => relayerAddress });

  console.log(`Agent Nonce:       ${agentAccount.nonce}`);
  console.log(`Relayer Nonce:     ${relayerAccount.nonce}`);

  // 4. ClawRouter AI Inference Fee (1,250 micro-USDC = $0.00125 for 1K input + 500 output tokens)
  const amountMicroUsdc = 1250;
  const hexAmount = amountMicroUsdc.toString(16).padStart(2, "0");
  const txData = `ESDTTransfer@${USDC_TOKEN_HEX}@${hexAmount}`;

  console.log(`Data Payload:      ${txData}`);

  const txComputer = new TransactionComputer();
  const tx = new Transaction({
    nonce: BigInt(agentAccount.nonce),
    value: 0n,
    sender: agentAddr,
    receiver: merchantAddr,
    gasPrice: 1000000000n,
    gasLimit: 600000n,
    data: Buffer.from(txData),
    chainID: "D",
    version: 2,
    options: 0,
    relayer: relayerAddr,
  });

  // Agent signs
  const bytesForAgent = txComputer.computeBytesForSigning(tx);
  tx.signature = await agentSigner.sign(bytesForAgent);

  // Relayer countersigns
  const bytesForRelayer = txComputer.computeBytesForSigning(tx);
  tx.relayerSignature = await relayerSigner.sign(bytesForRelayer);

  const txHash = await provider.sendTransaction(tx);
  console.log(`\n🚀 Relayed V3 ClawRouter Settlement Broadcasted!`);
  console.log(`TxHash: ${txHash}`);
  console.log(`Explorer: https://devnet-explorer.multiversx.com/transactions/${txHash}`);

  console.log(`Waiting for Devnet block finalization...`);
  const finishedTx = await waitForTx(provider, txHash);
  console.log(`\n✅ ClawRouter Settlement SUCCESSFUL on MultiversX Devnet! Status: ${finishedTx.status.status}`);

  return {
    txHash,
    status: finishedTx.status.status,
    explorerUrl: `https://devnet-explorer.multiversx.com/transactions/${txHash}`,
  };
}

if (process.argv[1]?.includes("settle_claw_devnet_live")) {
  runClawLiveSettlement().catch((err) => {
    console.error("Live settlement failed:", err);
    process.exit(1);
  });
}
