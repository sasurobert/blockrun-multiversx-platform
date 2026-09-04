import dotenv from "dotenv";
dotenv.config();
dotenv.config({ path: ".env.local", override: true });

import fs from "fs";
import path from "path";
import http from "http";
import express from "express";
import { MvxApiNetworkProvider } from "../domain/network.js";
import { RelayerPoolManager } from "../services/relayer_pool.js";
import { VerifierService } from "../services/verifier.js";
import { SettlerService } from "../services/settler.js";
import { SettlementQueue } from "../services/settlement_queue.js";
import { SqliteSettlementStorage } from "../storage/sqlite_storage.js";
import { MemorySettlementStorage } from "../storage/memory_storage.js";
import { ISettlementStorage } from "../storage/types.js";
import { createFacilitatorServer } from "../server/facilitator_server.js";
import { createBlockRunGateway } from "../gateway/blockrun_gateway.js";
import { MerchantPoolManager } from "../services/merchant_pool.js";
import { TreasurySweeperService } from "../services/treasury_sweeper.js";
import { TollboothServer } from "../tollbooth/tollbooth_server.js";
import { PipelinedSettlementQueue } from "../services/pipelined_settlement_queue.js";
import { RelayerGasSentinel } from "../services/relayer_gas_sentinel.js";
import { Mnemonic, UserSigner } from "@multiversx/sdk-wallet";

/**
 * Starts the BlockRun MultiversX Gateway and x402 Facilitator services.
 */
export async function startServers() {
  const gatewayPort = parseInt(process.env.PORT || process.env.GATEWAY_PORT || "3000", 10);
  const facilitatorPort = parseInt(process.env.FACILITATOR_PORT || "3402", 10);
  const network = process.env.MULTIVERSX_NETWORK || "multiversx:1";
  const apiUrl = process.env.MULTIVERSX_API_URL || "https://api.multiversx.com";
  const usdcToken = process.env.USDC_TOKEN_IDENTIFIER || "USDC-c76f1f";
  const sqliteDbPath = process.env.SQLITE_DB_PATH || "./data/settlements.db";
  const rateLimitEnabled = process.env.RATE_LIMIT_ENABLED !== "false";

  console.log("=================================================");
  console.log(" Starting BlockRun MultiversX Gateway & Facilitator");
  console.log("=================================================");
  console.log(`Network:           ${network}`);
  console.log(`MultiversX API:    ${apiUrl}`);
  console.log(`USDC Token ID:     ${usdcToken}`);
  console.log(`Gateway Port:      ${gatewayPort}`);
  console.log(`Facilitator Port:  ${facilitatorPort}`);

  // 1. Initialize Network Provider
  const networkProvider = new MvxApiNetworkProvider(apiUrl, {
    timeout: 10000,
    clientName: "blockrun-multiversx-gateway",
  });

  // 2. Initialize Relayer Pool
  let relayerPool: RelayerPoolManager;
  if (process.env.RELAYER_MNEMONIC) {
    console.log("Initializing Relayer Pool from mnemonic...");
    relayerPool = RelayerPoolManager.fromMnemonic(process.env.RELAYER_MNEMONIC.trim());
  } else if (process.env.RELAYER_PEM) {
    console.log("Initializing Relayer Pool from PEM string...");
    relayerPool = RelayerPoolManager.fromPem(process.env.RELAYER_PEM.trim());
  } else if (process.env.RELAYER_PEM_PATH && fs.existsSync(process.env.RELAYER_PEM_PATH)) {
    console.log(`Initializing Relayer Pool from PEM file: ${process.env.RELAYER_PEM_PATH}...`);
    const pemContent = fs.readFileSync(process.env.RELAYER_PEM_PATH, "utf8");
    relayerPool = RelayerPoolManager.fromPem(pemContent);
  } else if (fs.existsSync(path.join(process.cwd(), "wallets", "relayer_shard0.pem"))) {
    const walletsDir = path.join(process.cwd(), "wallets");
    console.log(`Auto-loading Relayer Pool from ${walletsDir}...`);
    const pemFiles = fs.readdirSync(walletsDir).filter((f) => f.startsWith("relayer") && f.endsWith(".pem"));
    let combinedPem = "";
    for (const file of pemFiles) {
      combinedPem += fs.readFileSync(path.join(walletsDir, file), "utf8") + "\n";
    }
    relayerPool = RelayerPoolManager.fromPem(combinedPem);
  } else {
    console.warn("WARNING: No RELAYER_MNEMONIC or RELAYER_PEM provided. Generating ephemeral relayer key for dev/test mode.");
    const devMnemonic = Mnemonic.generate();
    relayerPool = RelayerPoolManager.fromMnemonic(devMnemonic.toString());
  }

  const relayerMap = relayerPool.getAllRelayerAddresses();
  console.log("Relayers initialized for shards:");
  for (const [shard, addr] of Object.entries(relayerMap)) {
    console.log(`  - Shard ${shard}: ${addr}`);
  }

  // 3. Initialize Merchant Pool (Shard-Aligned Multi-Merchant Receivers)
  const merchantPool = new MerchantPoolManager();
  console.log("Shard-Aligned Merchants initialized:");
  for (const m of merchantPool.getAllMerchants()) {
    console.log(`  - Shard ${m.shard}: ${m.address}`);
  }

  let merchantPayTo = process.env.MERCHANT_PAY_TO || merchantPool.getMerchantAddressForShard(0);

  // 4. Initialize Settlement Storage
  let storage: ISettlementStorage;
  if (sqliteDbPath && sqliteDbPath !== ":memory:") {
    console.log(`Initializing SQLite settlement storage at: ${sqliteDbPath}`);
    storage = new SqliteSettlementStorage(sqliteDbPath);
  } else {
    console.log("Initializing In-Memory settlement storage");
    storage = new MemorySettlementStorage();
  }

  // 5. Initialize Services
  const verifier = new VerifierService({
    relayerPool,
    networkProvider,
  });

  const settler = new SettlerService({
    storage,
    networkProvider,
    relayerPool,
    verifier,
  });

  const settlementQueue = new SettlementQueue({
    settler,
    relayerPool,
  });

  const treasurySweeper = new TreasurySweeperService({
    merchantPool,
    masterTreasuryAddress: merchantPayTo,
    tokenId: usdcToken,
    apiUrl,
  });

  // Initialize Relayer Gas Sentinel & Auto-Top-Up
  let treasurySigner: UserSigner | null = null;
  const treasuryPemPath = process.env.TREASURY_PEM_PATH || path.join(process.cwd(), "wallets", "merchant.pem");
  if (process.env.TREASURY_PEM) {
    treasurySigner = UserSigner.fromPem(process.env.TREASURY_PEM);
  } else if (fs.existsSync(treasuryPemPath)) {
    treasurySigner = UserSigner.fromPem(fs.readFileSync(treasuryPemPath, "utf-8"));
  }

  let gasSentinel: RelayerGasSentinel | null = null;
  if (treasurySigner) {
    const chainID = network.includes(":D") ? "D" : network.includes(":T") ? "T" : "1";
    gasSentinel = new RelayerGasSentinel({
      networkProvider,
      relayerPool,
      treasurySigner,
      chainID,
      checkIntervalMs: 60_000,
    });
    gasSentinel.start();
    console.log("RelayerGasSentinel active: monitoring on-chain EGLD balances with auto-top-up.");
  }

  // 6. Create Express Apps
  const facilitatorApp = createFacilitatorServer({
    verifier,
    settlementQueue,
    relayerPool,
    supportedNetworks: [network],
    rateLimit: { enabled: rateLimitEnabled },
  });

  const gatewayApp = createBlockRunGateway({
    verifier,
    settlementQueue,
    relayerPool,
    merchantPool,
    treasurySweeper,
    storage,
    payTo: merchantPayTo,
    network,
    asset: usdcToken,
    geminiApiKey: process.env.GEMINI_API_KEY,
    rateLimit: { enabled: rateLimitEnabled },
  });

  // Mount Anti-Bot Scraper Tollbooth
  const tollbooth = new TollboothServer({
    verifier,
    settlementQueue,
    network,
    tokenIdentifier: usdcToken,
    storage,
    originUrl: `http://localhost:${gatewayPort}`,
  });
  gatewayApp.use("/tollbooth", tollbooth.app);

  // Serve WebUI dashboard statically if built
  const webuiDist = path.resolve(process.cwd(), "webui/dist");
  if (fs.existsSync(webuiDist)) {
    console.log(`Serving WebUI dashboard from: ${webuiDist}`);
    gatewayApp.use(express.static(webuiDist));
  }

  // 7. Start HTTP Servers
  const facilitatorServer = http.createServer(facilitatorApp);
  const gatewayServer = http.createServer(gatewayApp);

  const startFacilitator = new Promise<void>((resolve) => {
    facilitatorServer.listen(facilitatorPort, () => {
      console.log(`x402 Facilitator listening at http://localhost:${facilitatorPort}`);
      console.log(`OpenAPI documentation at http://localhost:${facilitatorPort}/openapi.json`);
      resolve();
    });
  });

  const startGateway = new Promise<void>((resolve) => {
    gatewayServer.listen(gatewayPort, () => {
      console.log(`BlockRun AI Gateway listening at http://localhost:${gatewayPort}`);
      console.log(`OpenAI API endpoint: http://localhost:${gatewayPort}/api/v1/chat/completions`);
      console.log(`Anthropic API endpoint: http://localhost:${gatewayPort}/api/v1/messages`);
      resolve();
    });
  });

  await Promise.all([startFacilitator, startGateway]);
  console.log("All servers started successfully.\n");

  // 8. Graceful Shutdown Handlers
  const shutdown = async () => {
    console.log("\nShutting down gracefully...");
    if (gasSentinel) {
      gasSentinel.stop();
    }
    await settlementQueue.drain();
    settlementQueue.clear();
    await new Promise<void>((resolve) => facilitatorServer.close(() => resolve()));
    await new Promise<void>((resolve) => gatewayServer.close(() => resolve()));
    storage.close();
    console.log("Shutdown complete.");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return {
    facilitatorServer,
    gatewayServer,
    settlementQueue,
    storage,
    gasSentinel,
  };
}

// Auto-run if executed directly as CLI
if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("src/bin/server.ts") ||
  process.argv[1]?.endsWith("dist/bin/server.js")
) {
  startServers().catch((err) => {
    console.error("Fatal server error:", err);
    process.exit(1);
  });
}
