#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { Address, AddressComputer, Transaction, TransactionComputer } from "@multiversx/sdk-core";
import { UserSigner, Mnemonic } from "@multiversx/sdk-wallet";
import { ApiNetworkProvider } from "@multiversx/sdk-network-providers";

const DEVNET_API = "https://devnet-api.multiversx.com";
const TOKEN_ID = "USDC-350c4e";
const TOKEN_HEX = Buffer.from(TOKEN_ID).toString("hex");

function generateWalletForShard(outputPath: string, targetShard: number): string {
  while (true) {
    const mnemonic = Mnemonic.generate();
    const secretKey = mnemonic.deriveKey(0);
    const pubKey = secretKey.generatePublicKey();
    const bech32Address = pubKey.toAddress().bech32();
    const computer = new AddressComputer();
    const shard = computer.getShardOfAddress(Address.newFromBech32(bech32Address));

    if (shard === targetShard) {
      const combinedBytes = Buffer.concat([secretKey.valueOf(), pubKey.valueOf()]);
      const combinedHex = combinedBytes.toString("hex");
      const base64Payload = Buffer.from(combinedHex).toString("base64");
      const lines = base64Payload.match(/.{1,64}/g)?.join("\n") || base64Payload;
      const pemContent = `-----BEGIN PRIVATE KEY for ${bech32Address}-----\n${lines}\n-----END PRIVATE KEY for ${bech32Address}-----\n`;
      fs.writeFileSync(outputPath, pemContent, { mode: 0o600 });
      return bech32Address;
    }
  }
}

async function sendTransaction(
  provider: ApiNetworkProvider,
  signer: UserSigner,
  nonce: number,
  receiver: string,
  valueEgld: string,
  dataString?: string
): Promise<string> {
  const senderAddr = signer.getAddress().bech32();
  const tx = new Transaction({
    nonce: BigInt(nonce),
    value: BigInt(valueEgld),
    sender: Address.newFromBech32(senderAddr),
    receiver: Address.newFromBech32(receiver),
    gasPrice: 1000000000n,
    gasLimit: dataString ? 600000n : 50000n,
    data: dataString ? Buffer.from(dataString) : Buffer.from(""),
    chainID: "D",
    version: 1,
  });

  const computer = new TransactionComputer();
  const bytesToSign = computer.computeBytesForSigning(tx);
  tx.signature = await signer.sign(bytesToSign);

  const txHash = await provider.sendTransaction(tx);
  return txHash;
}

async function main() {
  console.log(`\n================================================================================`);
  console.log(`  STEP 3: Prepare Shard 1 & Shard 2 (Fund Relayers & Agents)`);
  console.log(`================================================================================`);

  const provider = new ApiNetworkProvider(DEVNET_API, { clientName: "blockrun-demo" });
  const walletsDir = path.resolve(process.cwd(), "wallets");

  // 1. Load Relayer 0 (Funder)
  const relayer0Pem = fs.readFileSync(path.join(walletsDir, "relayer_shard0.pem"), "utf-8");
  const relayer0Signer = UserSigner.fromPem(relayer0Pem);
  const relayer0Addr = relayer0Signer.getAddress().bech32();

  // 2. Load or create Agent 1 & Agent 2
  const agent1Path = path.join(walletsDir, "agent_shard1.pem");
  let agent1Addr: string;
  if (!fs.existsSync(agent1Path)) {
    agent1Addr = generateWalletForShard(agent1Path, 1);
  } else {
    agent1Addr = UserSigner.fromPem(fs.readFileSync(agent1Path, "utf-8")).getAddress().bech32();
  }

  const agent2Path = path.join(walletsDir, "agent_shard2.pem");
  let agent2Addr: string;
  if (!fs.existsSync(agent2Path)) {
    agent2Addr = generateWalletForShard(agent2Path, 2);
  } else {
    agent2Addr = UserSigner.fromPem(fs.readFileSync(agent2Path, "utf-8")).getAddress().bech32();
  }

  // Load Relayers 1 & 2
  const relayer1Pem = fs.readFileSync(path.join(walletsDir, "relayer_shard1.pem"), "utf-8");
  const relayer1Addr = UserSigner.fromPem(relayer1Pem).getAddress().bech32();

  const relayer2Pem = fs.readFileSync(path.join(walletsDir, "relayer_shard2.pem"), "utf-8");
  const relayer2Addr = UserSigner.fromPem(relayer2Pem).getAddress().bech32();

  console.log(`Shard 1 Relayer: ${relayer1Addr}`);
  console.log(`Shard 1 Agent:   ${agent1Addr}`);
  console.log(`Shard 2 Relayer: ${relayer2Addr}`);
  console.log(`Shard 2 Agent:   ${agent2Addr}`);

  // Fetch current nonce of relayer 0
  const accRes = await fetch(`${DEVNET_API}/accounts/${relayer0Addr}`);
  const accData = await accRes.json();
  let currentNonce = accData.nonce;
  console.log(`\nRelayer 0 Starting Nonce: ${currentNonce}`);

  // Transfer 5 EGLD to Relayer 1
  console.log(`\n1. Sending 5 EGLD to Shard 1 Relayer...`);
  const tx1 = await sendTransaction(provider, relayer0Signer, currentNonce++, relayer1Addr, "5000000000000000000");
  console.log(`   Tx Hash: ${tx1}`);

  // Transfer 5 EGLD to Relayer 2
  console.log(`2. Sending 5 EGLD to Shard 2 Relayer...`);
  const tx2 = await sendTransaction(provider, relayer0Signer, currentNonce++, relayer2Addr, "5000000000000000000");
  console.log(`   Tx Hash: ${tx2}`);

  // Transfer 5 USDC to Agent 1 (5,000,000 micro-USDC = 0x4c4b40)
  console.log(`3. Sending 5 USDC to Shard 1 Agent...`);
  const tx3 = await sendTransaction(
    provider,
    relayer0Signer,
    currentNonce++,
    agent1Addr,
    "0",
    `ESDTTransfer@${TOKEN_HEX}@4c4b40`
  );
  console.log(`   Tx Hash: ${tx3}`);

  // Transfer 5 USDC to Agent 2 (5,000,000 micro-USDC = 0x4c4b40)
  console.log(`4. Sending 5 USDC to Shard 2 Agent...`);
  const tx4 = await sendTransaction(
    provider,
    relayer0Signer,
    currentNonce++,
    agent2Addr,
    "0",
    `ESDTTransfer@${TOKEN_HEX}@4c4b40`
  );
  console.log(`   Tx Hash: ${tx4}`);

  console.log(`\nWaiting for Sirius blocks to settle all 4 setup transactions...`);
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1200));
    const [t1, t2, t3, t4] = await Promise.all([
      fetch(`${DEVNET_API}/transactions/${tx1}`).then((r) => r.json()),
      fetch(`${DEVNET_API}/transactions/${tx2}`).then((r) => r.json()),
      fetch(`${DEVNET_API}/transactions/${tx3}`).then((r) => r.json()),
      fetch(`${DEVNET_API}/transactions/${tx4}`).then((r) => r.json()),
    ]);
    process.stdout.write(`   Tx1: ${t1.status} | Tx2: ${t2.status} | Tx3: ${t3.status} | Tx4: ${t4.status}\n`);
    if (
      t1.status === "success" &&
      t2.status === "success" &&
      t3.status === "success" &&
      t4.status === "success"
    ) {
      console.log(`\n🎉 ALL 4 TRANSACTIONS EXECUTED SUCCESSFULLY!`);
      break;
    }
  }

  console.log(`\n✅ Setup complete! Shard 1 and Shard 2 are fully funded and ready for Relayed V3 tests.`);
}

main().catch((err) => {
  console.error("Step 3 setup failed:", err);
  process.exit(1);
});
