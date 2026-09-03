import { describe, it, expect, beforeEach } from "vitest";
import { Mnemonic, UserSigner } from "@multiversx/sdk-wallet";
import { Address } from "@multiversx/sdk-core";
import {
  PipelinedRelayerPool,
  PipelinedRelayerConfig,
} from "../../src/services/pipelined_relayer_pool.js";

describe("PipelinedRelayerPool (Sirius 0.6s High-Velocity Architecture)", () => {
  let mnemonic: string;

  beforeEach(() => {
    mnemonic = Mnemonic.generate().toString();
  });

  it("should derive 8 active relayers per execution shard (24 total) from mnemonic", () => {
    const pool = PipelinedRelayerPool.fromMnemonic(mnemonic, {
      relayersPerShard: 8,
      shardsToCover: [0, 1, 2],
      maxScanIndex: 120,
    });

    for (const shard of [0, 1, 2]) {
      const relayers = pool.getAllRelayersForShard(shard);
      expect(relayers.length).toBeGreaterThanOrEqual(8);
    }
  });

  it("should rotate relayers round-robin within the same shard", () => {
    const pool = PipelinedRelayerPool.fromMnemonic(mnemonic, {
      relayersPerShard: 4,
      shardsToCover: [0, 1, 2],
      maxScanIndex: 60,
    });

    const shard0Relayers = pool.getAllRelayersForShard(0);
    const r1 = pool.getNextRelayerForShard(0);
    const r2 = pool.getNextRelayerForShard(0);
    const r3 = pool.getNextRelayerForShard(0);
    const r4 = pool.getNextRelayerForShard(0);
    const r5 = pool.getNextRelayerForShard(0);

    expect(r1.getAddress().bech32()).toBe(shard0Relayers[0].getAddress().bech32());
    expect(r2.getAddress().bech32()).toBe(shard0Relayers[1].getAddress().bech32());
    expect(r3.getAddress().bech32()).toBe(shard0Relayers[2].getAddress().bech32());
    expect(r4.getAddress().bech32()).toBe(shard0Relayers[3].getAddress().bech32());
    // Loops back to 0
    expect(r5.getAddress().bech32()).toBe(shard0Relayers[0].getAddress().bech32());
  });

  it("should atomically reserve pipelined nonces without gaps or collisions", () => {
    const pool = PipelinedRelayerPool.fromMnemonic(mnemonic, {
      relayersPerShard: 1,
      shardsToCover: [0],
      maxScanIndex: 30,
    });

    const relayer = pool.getRelayerForShard(0);
    const relayerAddr = relayer.getAddress().bech32();

    // Initialize starting nonce at 100
    pool.resyncNonce(relayerAddr, 100n);

    // Concurrently reserve 250 pipelined nonces
    const nonces: bigint[] = [];
    for (let i = 0; i < 250; i++) {
      nonces.push(pool.reserveNonce(relayerAddr));
    }

    expect(nonces).toHaveLength(250);
    expect(nonces[0]).toBe(100n);
    expect(nonces[249]).toBe(349n);
    expect(pool.getInFlightCount(relayerAddr)).toBe(250);

    // Confirm first 100 nonces
    for (let i = 0; i < 100; i++) {
      pool.confirmNonce(relayerAddr, BigInt(100 + i));
    }
    expect(pool.getInFlightCount(relayerAddr)).toBe(150);
  });

  it("should enforce mempool in-flight threshold (250 txs) and report available capacity", () => {
    const pool = PipelinedRelayerPool.fromMnemonic(mnemonic, {
      relayersPerShard: 1,
      shardsToCover: [0],
      maxScanIndex: 30,
    });

    const relayer = pool.getRelayerForShard(0);
    const relayerAddr = relayer.getAddress().bech32();
    pool.resyncNonce(relayerAddr, 0n);

    // Reserve 250
    for (let i = 0; i < 250; i++) {
      pool.reserveNonce(relayerAddr);
    }

    expect(pool.canAcceptTransaction(relayerAddr, 250)).toBe(false);

    // Release 10
    pool.confirmNonce(relayerAddr, 9n);
    expect(pool.canAcceptTransaction(relayerAddr, 250)).toBe(true);
  });
});
