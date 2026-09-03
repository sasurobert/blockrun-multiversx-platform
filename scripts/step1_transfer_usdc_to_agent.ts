#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { Address, Transaction, TransactionComputer } from "@multiversx/sdk-core";
import { UserSigner } from "@multiversx/sdk-wallet";
import { ApiNetworkProvider } from "@multiversx/sdk-network-providers";

const DEVNET_API = "https://devnet-api.multiversx.com";
const TOKEN_ID = "USDC-350c4e";
const TOKEN_HEX = Buffer.from(TOKEN_ID).toString("hex");

async function main() {
  console.log(`\n================================================================================`);
  console.log(`  STEP 1: Fund Agent with 20 USDC from Relayer 0 on Devnet`);
  console.log(`================================================================================`);

  const provider = new ApiNetworkProvider(DEVNET_API, { clientName: "blockrun-demo" });

  // Load Relayer (Shard 0)
  const relayerPemPath = path.resolve(process.cwd(), "wallets/relayer_shard0.pem");
  const relayerPem = fs.readFileSync(relayerPemPath, "utf-8");
  const relayerSigner = UserSigner.fromPem(relayerPem);
  const relayerAddr = relayerSigner.getAddress().bech32();

  // Load Agent (Shard 0)
  const agentPemPath = path.resolve(process.cwd(), "wallets/agent.pem");
  const agentPem = fs.readFileSync(agentPemPath, "utf-8");
  const agentSigner = UserSigner.fromPem(agentPem);
  const agentAddr = agentSigner.getAddress().bech32();

  console.log(`Sender (Relayer 0): ${relayerAddr}`);
  console.log(`Receiver (Agent):   ${agentAddr}`);

  // Fetch live on-chain account
  const accountOnNetwork = await provider.getAccount(Address.newFromBech32(relayerAddr));
  console.log(`Sender Nonce:       ${accountOnNetwork.nonce}`);
  console.log(`Sender Balance:     ${(Number(accountOnNetwork.balance) / 1e18).toFixed(4)} EGLD`);

  // Amount: 20 USDC = 20,000,000 micro-USDC = 0x01312d00
  const amountMicro = 20_000_000n;
  let amountHex = amountMicro.toString(16);
  if (amountHex.length % 2 !== 0) amountHex = "0" + amountHex;

  const dataString = `ESDTTransfer@${TOKEN_HEX}@${amountHex}`;
  console.log(`Data Payload:       ${dataString}`);

  const tx = new Transaction({
    nonce: BigInt(accountOnNetwork.nonce),
    value: 0n,
    sender: Address.newFromBech32(relayerAddr),
    receiver: Address.newFromBech32(agentAddr),
    gasPrice: 1000000000n,
    gasLimit: 600000n,
    data: Buffer.from(dataString),
    chainID: "D",
    version: 1,
  });

  const computer = new TransactionComputer();
  const bytesToSign = computer.computeBytesForSigning(tx);
  const signature = await relayerSigner.sign(bytesToSign);
  tx.signature = signature;

  console.log(`Broadcasting transaction via ApiNetworkProvider...`);
  const txHash = await provider.sendTransaction(tx);
  console.log(`\n✅ TRANSACTION BROADCAST SUCCESSFUL!`);
  console.log(`   Tx Hash:       ${txHash}`);
  console.log(`   Explorer Link: https://devnet-explorer.multiversx.com/transactions/${txHash}\n`);

  console.log(`Waiting for Sirius block confirmation...`);
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const txOnNet = await provider.getTransaction(txHash);
      process.stdout.write(`   Round: ${txOnNet.round} | Status: ${txOnNet.status.valueOf()}\n`);
      if (txOnNet.status.isSuccessful()) {
        console.log(`\n🎉 TRANSACTION CONFIRMED ON MULTIVERSX DEVNET!`);
        break;
      }
      if (txOnNet.status.isFailed() || txOnNet.status.isInvalid()) {
        throw new Error(`Transaction failed with status: ${txOnNet.status.valueOf()}`);
      }
    } catch (e: any) {
      process.stdout.write(`   Querying... (${e.message})\n`);
    }
  }

  // Verify Agent token balance
  const tokenRes = await fetch(`${DEVNET_API}/accounts/${agentAddr}/tokens/${TOKEN_ID}`);
  if (tokenRes.ok) {
    const tokenData = await tokenRes.json();
    console.log(`\n💰 Agent USDC Balance: ${(Number(tokenData.balance) / 1e6).toFixed(2)} USDC`);
  }
}

main().catch((err) => {
  console.error("Step 1 failed:", err);
  process.exit(1);
});
