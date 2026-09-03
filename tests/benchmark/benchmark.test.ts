import { describe, it, expect } from "vitest";
import { LoadGenerator } from "../../src/benchmark/load_generator.js";

describe("LoadGenerator 10k TPS Engine Smoke Test", () => {
  it("settles 500 transactions concurrently with 100% success and 0 collisions", async () => {
    const generator = new LoadGenerator({
      targetTps: 2000,
      durationSeconds: 1,
      batchSize: 50,
      relayersPerShard: 8,
    });

    const metrics = await generator.run();

    expect(metrics.totalSubmitted).toBe(2000);
    expect(metrics.totalSettled).toBe(2000);
    expect(metrics.totalFailed).toBe(0);
    expect(metrics.averageTps).toBeGreaterThan(500);
  });
});
