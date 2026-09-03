import crypto from "crypto";
import { Address, Transaction, TransactionComputer } from "@multiversx/sdk-core";
import { Mnemonic, UserSigner } from "@multiversx/sdk-wallet";
import { SettleRequest } from "../domain/types.js";
import { PipelinedSettlementQueue } from "../services/pipelined_settlement_queue.js";
import { PipelinedRelayerPool } from "../services/pipelined_relayer_pool.js";
import { BatchNetworkProvider } from "../services/batch_network_provider.js";
import { MemorySettlementStorage } from "../storage/memory_storage.js";

export interface LoadGeneratorConfig {
  targetTps: number;
  durationSeconds: number;
  batchSize?: number;
  relayersPerShard?: number;
}

export interface BenchmarkMetrics {
  totalSubmitted: number;
  totalSettled: number;
  totalFailed: number;
  instantTps: number;
  averageTps: number;
  peakTps: number;
  elapsedMs: number;
  latencies: number[];
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  shardDistribution: Record<number, number>;
  activeWorkers: number;
}

export class LoadGenerator {
  private readonly config: LoadGeneratorConfig;
  private readonly pool: PipelinedRelayerPool;
  private readonly batchProvider: BatchNetworkProvider;
  private readonly storage: MemorySettlementStorage;
  private readonly queue: PipelinedSettlementQueue;
  private readonly transactionComputer: TransactionComputer;

  private userSigners: UserSigner[] = [];
  private merchantAddress: string;

  constructor(config: LoadGeneratorConfig) {
    this.config = config;
    this.transactionComputer = new TransactionComputer();

    const mnemonic = Mnemonic.generate().toString();
    this.pool = PipelinedRelayerPool.fromMnemonic(mnemonic, {
      relayersPerShard: config.relayersPerShard ?? 8,
      shardsToCover: [0, 1, 2],
      maxScanIndex: 120,
    });

    this.batchProvider = new BatchNetworkProvider({
      mode: "simulation",
      strictNonceCheck: true,
    });
    this.storage = new MemorySettlementStorage();
    this.queue = new PipelinedSettlementQueue({
      relayerPool: this.pool,
      batchProvider: this.batchProvider,
      storage: this.storage,
      batchSize: config.batchSize ?? 50,
      flushIntervalMs: 1,
      maxQueueDepth: 100000,
      mode: "benchmark",
    });

    this.merchantAddress = "erd1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq6gq4hu";

    // Pre-derive 200 simulated agent wallets across all 3 shards
    const userMnemonic = Mnemonic.generate();
    for (let i = 0; i < 200; i++) {
      this.userSigners.push(new UserSigner(userMnemonic.deriveKey(i)));
    }
  }

  private prepareRequests(count: number): SettleRequest[] {
    const userNonces = new Map<number, bigint>();
    for (let i = 0; i < this.userSigners.length; i++) {
      userNonces.set(i, 1n);
    }
    const requests: SettleRequest[] = [];
    for (let i = 0; i < count; i++) {
      const userIdx = i % this.userSigners.length;
      const userSigner = this.userSigners[userIdx];
      const userAddr = userSigner.getAddress().bech32();
      const nonce = userNonces.get(userIdx)!;
      userNonces.set(userIdx, nonce + 1n);

      const sig = crypto
        .createHash("sha256")
        .update(userAddr)
        .update(String(nonce))
        .digest("hex");

      requests.push({
        paymentPayload: {
          x402Version: 2,
          accepted: {
            scheme: "exact",
            network: "multiversx:1",
            amount: "1000",
            asset: "USDC-c76f1f",
            payTo: this.merchantAddress,
            maxTimeoutSeconds: 300,
          },
          payload: {
            nonce: Number(nonce),
            value: "0",
            receiver: this.merchantAddress,
            sender: userAddr,
            gasPrice: 1000000000,
            gasLimit: 500000,
            data: "ESDTTransfer@555344432d633736663166@03e8",
            chainID: "1",
            version: 2,
            options: 0,
            signature: sig,
          },
        },
        paymentRequirements: {
          scheme: "exact",
          network: "multiversx:1",
          amount: "1000",
          asset: "USDC-c76f1f",
          payTo: this.merchantAddress,
          maxTimeoutSeconds: 300,
        },
      });
    }
    return requests;
  }

  async run(onProgress?: (metrics: BenchmarkMetrics) => void): Promise<BenchmarkMetrics> {
    const totalTargetTxs = this.config.targetTps * this.config.durationSeconds;
    const requests = this.prepareRequests(totalTargetTxs);

    let submitted = 0;
    let settled = 0;
    let failed = 0;
    let peakTps = 0;
    const latencies: number[] = [];
    const shardCounts: Record<number, number> = { 0: 0, 1: 0, 2: 0 };

    for (const req of requests) {
      const sender = (req.paymentPayload.payload as any).sender;
      const shard = this.pool.getShardForAddress(sender);
      shardCounts[shard] = (shardCounts[shard] || 0) + 1;
    }

    const startTime = Date.now();
    let lastTickTime = startTime;
    let lastSettledCount = 0;
    let instantTps = 0;

    const progressTimer = setInterval(() => {
      const now = Date.now();
      const deltaSec = (now - lastTickTime) / 1000;
      if (deltaSec > 0) {
        instantTps = Math.round((settled - lastSettledCount) / deltaSec);
        if (instantTps > peakTps) peakTps = instantTps;
        lastSettledCount = settled;
        lastTickTime = now;
      }

      if (onProgress) {
        onProgress(
          this.calculateMetrics(
            submitted,
            settled,
            failed,
            instantTps,
            peakTps,
            startTime,
            latencies,
            shardCounts
          )
        );
      }
    }, 100);

    // Parallel shard pipelines
    const shard0Reqs: SettleRequest[] = [];
    const shard1Reqs: SettleRequest[] = [];
    const shard2Reqs: SettleRequest[] = [];

    for (const req of requests) {
      const sender = (req.paymentPayload.payload as any).sender;
      const shard = this.pool.getShardForAddress(sender);
      shardCounts[shard] = (shardCounts[shard] || 0) + 1;
      if (shard === 0) shard0Reqs.push(req);
      else if (shard === 1) shard1Reqs.push(req);
      else shard2Reqs.push(req);
    }

    const activePromises: Promise<any>[] = [];

    const dispatchShard = async (shardList: SettleRequest[]) => {
      const chunkSize = 3500;
      for (let i = 0; i < shardList.length; i += chunkSize) {
        const chunk = shardList.slice(i, i + chunkSize);
        submitted += chunk.length;
        for (const req of chunk) {
          const submitTime = Date.now();
          activePromises.push(
            this.queue
              .settle(req)
              .then((res) => {
                if (res.success) {
                  settled++;
                  latencies.push(Date.now() - submitTime);
                } else {
                  failed++;
                }
              })
              .catch(() => {
                failed++;
              })
          );
        }
        await new Promise((r) => setImmediate(r));
      }
    };

    await Promise.all([
      dispatchShard(shard0Reqs),
      dispatchShard(shard1Reqs),
      dispatchShard(shard2Reqs),
    ]);

    await Promise.all(activePromises);
    clearInterval(progressTimer);

    return this.calculateMetrics(
      submitted,
      settled,
      failed,
      instantTps,
      peakTps,
      startTime,
      latencies,
      shardCounts
    );
  }

  private calculateMetrics(
    submitted: number,
    settled: number,
    failed: number,
    instantTps: number,
    peakTps: number,
    startTime: number,
    latencies: number[],
    shardDistribution: Record<number, number>
  ): BenchmarkMetrics {
    const elapsedMs = Math.max(1, Date.now() - startTime);
    const averageTps = Math.round((settled / elapsedMs) * 1000);

    const sortedLat = [...latencies].sort((a, b) => a - b);
    const p50 = sortedLat.length > 0 ? sortedLat[Math.floor(sortedLat.length * 0.5)] : 0;
    const p95 = sortedLat.length > 0 ? sortedLat[Math.floor(sortedLat.length * 0.95)] : 0;
    const p99 = sortedLat.length > 0 ? sortedLat[Math.floor(sortedLat.length * 0.99)] : 0;

    return {
      totalSubmitted: submitted,
      totalSettled: settled,
      totalFailed: failed,
      instantTps,
      averageTps,
      peakTps,
      elapsedMs,
      latencies: sortedLat,
      p50LatencyMs: p50,
      p95LatencyMs: p95,
      p99LatencyMs: p99,
      shardDistribution,
      activeWorkers: this.pool.getAllRelayers().length,
    };
  }
}
