import dotenv from "dotenv";
dotenv.config();
import http from "http";
import path from "path";
import fs from "fs";
import { ClawRouterServer } from "../router/router_server.js";
import { VerifierService } from "../services/verifier.js";
import { MvxApiNetworkProvider } from "../domain/network.js";
import { MerchantPoolManager } from "../services/merchant_pool.js";
import { ArbitrageMatrix } from "../router/arbitrage_matrix.js";
import { CascadingFallbackDispatcher } from "../router/fallback_dispatcher.js";
import { TwoPhaseReconciler } from "../router/two_phase_reconciler.js";
import { createLiveStreamExecutor } from "../router/live_stream_executor.js";

async function main() {
  const port = parseInt(process.env.CLAW_ROUTER_PORT || process.env.ROUTER_PORT || "4400", 10);
  const apiUrl = process.env.MULTIVERSX_API_URL || "https://devnet-api.multiversx.com";
  const network = process.env.MULTIVERSX_NETWORK || "multiversx:D";
  const sqliteDbPath = process.env.SQLITE_DB_PATH || "./data/settlements.db";

  console.log(`============================================================`);
  console.log(`         Starting MultiversX ClawRouter Gateway             `);
  console.log(`============================================================`);
  console.log(`Port:           ${port}`);
  console.log(`Network:        ${network}`);
  console.log(`API URL:        ${apiUrl}`);
  console.log(`SQLite DB:      ${sqliteDbPath}`);

  // Ensure data dir exists
  const dataDir = path.dirname(sqliteDbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const networkProvider = new MvxApiNetworkProvider(apiUrl, {
    clientName: "multiversx-claw-router",
  });

  const verifier = new VerifierService({
    networkProvider,
  });

  const merchantPool = new MerchantPoolManager();
  const reconciler = new TwoPhaseReconciler(sqliteDbPath);

  // Initialize Arbitrage Matrix with Real Production Providers
  const matrix = new ArbitrageMatrix();
  matrix.registerProvider({
    id: "google-gemini",
    name: "Google Gemini",
    endpoint: "https://generativelanguage.googleapis.com",
    costPerMillionInputTokensUsd: 0.1,
    costPerMillionOutputTokensUsd: 0.4,
    avgTtftMs: 250,
    tokensPerSecond: 120,
    healthy: true,
    supportedModels: [
      "google/gemini-2.5-flash-lite",
      "gemini-2.5-flash-lite",
      "gemini-flash",
      "llama-3.3-70b",
      "deepseek-r1",
    ],
  });

  matrix.registerProvider({
    id: "groq-fast",
    name: "Groq LPU",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    costPerMillionInputTokensUsd: 0.59,
    costPerMillionOutputTokensUsd: 0.79,
    avgTtftMs: 140,
    tokensPerSecond: 280,
    healthy: true,
    supportedModels: ["llama-3.3-70b", "deepseek-r1", "meta/llama-3.3-70b-instruct"],
  });

  matrix.registerProvider({
    id: "together-ai",
    name: "Together AI",
    endpoint: "https://api.together.xyz/v1/chat/completions",
    costPerMillionInputTokensUsd: 0.88,
    costPerMillionOutputTokensUsd: 0.88,
    avgTtftMs: 280,
    tokensPerSecond: 110,
    healthy: true,
    supportedModels: ["llama-3.3-70b", "deepseek-r1"],
  });

  matrix.registerProvider({
    id: "deepinfra-speed",
    name: "DeepInfra",
    endpoint: "https://api.deepinfra.com/v1/openai/chat/completions",
    costPerMillionInputTokensUsd: 0.5,
    costPerMillionOutputTokensUsd: 0.75,
    avgTtftMs: 310,
    tokensPerSecond: 95,
    healthy: true,
    supportedModels: ["deepseek-r1", "llama-3.3-70b"],
  });

  matrix.registerProvider({
    id: "cerebras-ultra",
    name: "Cerebras CS-3",
    endpoint: "https://api.cerebras.ai/v1/chat/completions",
    costPerMillionInputTokensUsd: 0.6,
    costPerMillionOutputTokensUsd: 0.8,
    avgTtftMs: 95,
    tokensPerSecond: 950,
    healthy: true,
    supportedModels: ["llama-3.3-70b"],
  });

  // Create real upstream live stream executor
  const streamExecutor = createLiveStreamExecutor();
  const dispatcher = new CascadingFallbackDispatcher({
    fallbackTimeoutMs: 800,
    streamExecutor,
  });

  const routerServer = new ClawRouterServer({
    verifier,
    merchantPool,
    network,
    matrix,
    dispatcher,
    reconciler,
  });

  const server = http.createServer(routerServer.app);

  server.listen(port, () => {
    console.log(`ClawRouter started on http://localhost:${port}`);
    console.log(`Health endpoint:  http://localhost:${port}/health`);
    console.log(`Completions:      http://localhost:${port}/v1/chat/completions`);
    console.log(`Speedometer info: http://localhost:${port}/api/v1/claw/speedometer`);
    console.log(`Provider matrix:  http://localhost:${port}/api/v1/claw/matrix`);
  });
}

if (process.argv[1]?.includes("claw_router")) {
  main().catch((err) => {
    console.error("ClawRouter startup error:", err);
    process.exit(1);
  });
}
