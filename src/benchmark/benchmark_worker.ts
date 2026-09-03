import { parentPort, workerData } from "node:worker_threads";
import { LoadGenerator, BenchmarkMetrics } from "./load_generator.js";

interface WorkerData {
  workerId: number;
  targetTps: number;
  durationSeconds: number;
  batchSize: number;
  relayersPerShard: number;
}

const data = workerData as WorkerData;

const generator = new LoadGenerator({
  targetTps: data.targetTps,
  durationSeconds: data.durationSeconds,
  batchSize: data.batchSize,
  relayersPerShard: data.relayersPerShard,
});

generator
  .run((metrics: BenchmarkMetrics) => {
    parentPort?.postMessage({ type: "progress", metrics });
  })
  .then((finalMetrics: BenchmarkMetrics) => {
    parentPort?.postMessage({ type: "done", metrics: finalMetrics });
  })
  .catch((err) => {
    parentPort?.postMessage({ type: "error", error: String(err) });
  });
