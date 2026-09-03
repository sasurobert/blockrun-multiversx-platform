#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { Address, AddressComputer } from "@multiversx/sdk-core";
import { UserSigner, Mnemonic } from "@multiversx/sdk-wallet";

interface GeneratedWallet {
  role: string;
  filename: string;
  address: string;
  shard: number;
}

function createPemFile(outputPath: string): { address: string; shard: number } {
  const mnemonic = Mnemonic.generate();
  const secretKey = mnemonic.deriveKey(0);
  const pubKey = secretKey.generatePublicKey();
  const bech32Address = pubKey.toAddress().bech32();

  const combinedBytes = Buffer.concat([secretKey.valueOf(), pubKey.valueOf()]);
  const combinedHex = combinedBytes.toString("hex");
  const base64Payload = Buffer.from(combinedHex).toString("base64");

  // Chunk base64 payload into 64-char lines
  const lines = base64Payload.match(/.{1,64}/g)?.join("\n") || base64Payload;
  const pemContent = `-----BEGIN PRIVATE KEY for ${bech32Address}-----\n${lines}\n-----END PRIVATE KEY for ${bech32Address}-----\n`;

  fs.writeFileSync(outputPath, pemContent, { mode: 0o600 });

  // Verification read
  const signer = UserSigner.fromPem(pemContent);
  if (signer.getAddress().bech32() !== bech32Address) {
    throw new Error(`PEM verification failed for ${bech32Address}`);
  }

  const computer = new AddressComputer();
  const shard = computer.getShardOfAddress(Address.newFromBech32(bech32Address));

  return { address: bech32Address, shard };
}

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

async function main() {
  const walletsDir = path.resolve(process.cwd(), "wallets");
  if (!fs.existsSync(walletsDir)) {
    fs.mkdirSync(walletsDir, { recursive: true });
  }

  console.log(`
================================================================================
  🔐 MULTIVERSX DEVNET WALLET & PEM GENERATOR
================================================================================
  Target Directory:  ${walletsDir}
  Security Notice:   Excluded by .gitignore (*.pem & wallets/ are NEVER committed)
================================================================================
`);

  const results: GeneratedWallet[] = [];

  // 1. Relayer Shard 0
  const relayer0Path = path.join(walletsDir, "relayer_shard0.pem");
  const relayer0Addr = generateWalletForShard(relayer0Path, 0);
  results.push({ role: "Relayer (Shard 0)", filename: "relayer_shard0.pem", address: relayer0Addr, shard: 0 });

  // 2. Relayer Shard 1
  const relayer1Path = path.join(walletsDir, "relayer_shard1.pem");
  const relayer1Addr = generateWalletForShard(relayer1Path, 1);
  results.push({ role: "Relayer (Shard 1)", filename: "relayer_shard1.pem", address: relayer1Addr, shard: 1 });

  // 3. Relayer Shard 2
  const relayer2Path = path.join(walletsDir, "relayer_shard2.pem");
  const relayer2Addr = generateWalletForShard(relayer2Path, 2);
  results.push({ role: "Relayer (Shard 2)", filename: "relayer_shard2.pem", address: relayer2Addr, shard: 2 });

  // 4. Autonomous AI Agent
  const agentPath = path.join(walletsDir, "agent.pem");
  const agentInfo = createPemFile(agentPath);
  results.push({ role: "Autonomous AI Agent", filename: "agent.pem", address: agentInfo.address, shard: agentInfo.shard });

  // 5. Merchant Payee
  const merchantPath = path.join(walletsDir, "merchant.pem");
  const merchantInfo = createPemFile(merchantPath);
  results.push({ role: "Merchant Payee", filename: "merchant.pem", address: merchantInfo.address, shard: merchantInfo.shard });

  console.log("Generated Wallets & Addresses:\n");
  for (const w of results) {
    console.log(`📌 ${w.role}:`);
    console.log(`   Address:  ${w.address}`);
    console.log(`   Shard:    Shard ${w.shard}`);
    console.log(`   PEM File: wallets/${w.filename}`);
    console.log(`   Explorer: https://devnet-explorer.multiversx.com/accounts/${w.address}\n`);
  }

  // Create .env.local referencing these wallets
  const envLocalPath = path.resolve(process.cwd(), ".env.local");
  const envContent = `# Auto-generated Devnet Wallet Paths (DO NOT COMMIT)
MULTIVERSX_NETWORK=devnet
MULTIVERSX_API_URL=https://devnet-api.multiversx.com
RELAYER_SHARD0_PEM=wallets/relayer_shard0.pem
RELAYER_SHARD1_PEM=wallets/relayer_shard1.pem
RELAYER_SHARD2_PEM=wallets/relayer_shard2.pem
AGENT_PEM=wallets/agent.pem
MERCHANT_PAY_TO=${merchantInfo.address}
USDC_TOKEN_IDENTIFIER=USDC-c76f1f
`;
  fs.writeFileSync(envLocalPath, envContent);
  console.log(`✅ Saved configuration to .env.local (also excluded by .gitignore)`);
}

main().catch((err) => {
  console.error("Wallet generation error:", err);
  process.exit(1);
});
