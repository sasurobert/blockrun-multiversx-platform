import "dotenv/config";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });

import { FleetService } from "../src/services/fleet_service.js";

async function main() {
  console.log("==================================================");
  console.log("  BlockRun MultiversX: Autonomous Fleet Runner    ");
  console.log("==================================================");

  const fleet = new FleetService({
    geminiApiKey: process.env.GEMINI_API_KEY,
  });

  const bots = fleet.getAllBots();
  console.log(`Loaded ${bots.length} autonomous bots:`);
  for (const bot of bots) {
    console.log(`  - [Shard ${bot.shard}] ${bot.name} (${bot.address.slice(0, 10)}...${bot.address.slice(-6)})`);
  }

  const intervalSeconds = parseInt(process.argv[2] || "15", 10);
  console.log(`\nStarting autonomous loop (interval: ${intervalSeconds}s)...`);
  console.log("Press Ctrl+C to stop.\n");

  let stepCount = 0;
  let running = true;

  process.on("SIGINT", () => {
    console.log("\nStopping autonomous fleet runner...");
    running = false;
    process.exit(0);
  });

  while (running) {
    const currentBot = bots[stepCount % bots.length];
    stepCount++;

    console.log(`--------------------------------------------------`);
    console.log(`[Step #${stepCount}] Triggering: ${currentBot.name} (Shard ${currentBot.shard})`);

    try {
      const startTime = Date.now();
      const result = await fleet.executeBotStep(currentBot.id);
      const elapsed = Date.now() - startTime;

      console.log(`  Prompt:    "${result.prompt}"`);
      console.log(`  Devnet Tx: ${result.txHash}`);
      console.log(`  Explorer:  ${result.explorerUrl}`);
      console.log(`  Gas Limit: ${result.gasLimit} (Sponsored: ${result.gasSponsored}, Agent EGLD: ${result.agentEgldSpent})`);
      console.log(`  Inference: "${result.completion.slice(0, 120)}..."`);
      console.log(`  Roundtrip: ${elapsed}ms`);
    } catch (err: any) {
      console.error(`  Execution Error: ${err.message || err}`);
    }

    if (!running) break;
    await new Promise((r) => setTimeout(r, intervalSeconds * 1000));
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
