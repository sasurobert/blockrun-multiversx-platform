import { describe, it, expect, beforeEach } from "vitest";
import { Address, Transaction, TransactionComputer } from "@multiversx/sdk-core";
import { Mnemonic, UserSigner } from "@multiversx/sdk-wallet";
import { PipelinedRelayerPool } from "../../src/services/pipelined_relayer_pool.js";
import { BatchNetworkProvider } from "../../src/services/batch_network_provider.js";
import { MemorySettlementStorage } from "../../src/storage/memory_storage.js";
import { PipelinedSettlementQueue } from "../../src/services/pipelined_settlement_queue.js";
import { SettleRequest } from "../../src/domain/types.js";

describe("PipelinedSettlementQueue (High-Throughput 0.6s Architecture)", () => {
  let mnemonic: string;
  let pool: PipelinedRelayerPool;
  let batchProvider: BatchNetworkProvider;
  let storage: MemorySettlementStorage;
  let queue: PipelinedSettlementQueue;

  beforeEach(() => {
    mnemonic = Mnemonic.generate().toString();
    pool = PipelinedRelayerPool.fromMnemonic(mnemonic, {
      relayersPerShard: 4,
      shardsToCover: [0, 1, 2],
      maxScanIndex: 60,
    });
    batchProvider = new BatchNetworkProvider({ mode: "simulation" });
    storage = new MemorySettlementStorage();
    queue = new PipelinedSettlementQueue({
      relayerPool: pool,
      batchProvider,
      storage,
      batchSize: 20,
      flushIntervalMs: 5,
    });
  });

  it("should settle a batch of 100 concurrent requests across shards with 100% success", async () => {
    const userSigner = new UserSigner(Mnemonic.generate().deriveKey(0));
    const userAddr = userSigner.getAddress().bech32();
    const merchantAddr = "erd1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq6gq4hu";

    const promises: Promise<any>[] = [];
    const tc = new TransactionComputer();

    for (let i = 0; i < 100; i++) {
      const userTx = new Transaction({
        nonce: BigInt(i + 1),
        value: 0n,
        sender: Address.newFromBech32(userAddr),
        receiver: Address.newFromBech32(merchantAddr),
        gasLimit: 500000n,
        gasPrice: 1000000000n,
        data: Buffer.from(`ESDTTransfer@555344432d633736663166@0${i}`),
        chainID: "1",
        version: 2,
      });

      const userSig = userSigner.sign(tc.computeBytesForSigning(userTx)).toString("hex");

      const req: SettleRequest = {
        x402Version: 2,
        paymentPayload: {
          nonce: i + 1,
          value: "0",
          receiver: merchantAddr,
          sender: userAddr,
          gasPrice: 1000000000,
          gasLimit: 500000,
          data: `ESDTTransfer@555344432d633736663166@0${i}`,
          chainID: "1",
          version: 2,
          signature: userSig,
        },
        paymentRequirements: {
          scheme: "exact",
          network: "multiversx:1",
          amount: "1000",
          asset: "USDC-c76f1f",
          payTo: merchantAddr,
          maxTimeoutSeconds: 300,
        },
      };

      promises.push(queue.settle(req));
    }

    const results = await Promise.all(promises);
    expect(results).toHaveLength(100);

    for (const res of results) {
      expect(res.success).toBe(true);
      expect(res.transaction).toBeDefined();
    }

    expect(batchProvider.getTotalSentCount()).toBe(100);
  });
});
