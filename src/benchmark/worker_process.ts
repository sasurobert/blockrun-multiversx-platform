import { LoadGenerator, BenchmarkMetrics } from "./load_generator.js";

process.on("message", async (msg: any) => {
  if (msg.type === "start") {
    const { targetTps, durationSeconds, batchSize, relayersPerShard } = msg;

    const generator = new LoadGenerator({
      targetTps,
      durationSeconds,
      batchSize,
      relayersPerShard,
    });

    try {
      const finalMetrics = await generator.run((metrics: BenchmarkMetrics) => {
        if (process.send) {
          process.send({ type: "progress", metrics });
        }
      });

      if (process.send) {
        process.send({ type: "done", metrics: finalMetrics });
      }
      process.exit(0);
    } catch (err) {
      if (process.send) {
        process.send({ type: "error", error: String(err) });
      }
      process.exit(1);
    }
  }
});
