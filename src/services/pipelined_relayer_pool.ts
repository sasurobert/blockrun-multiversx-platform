import { Address, AddressComputer } from "@multiversx/sdk-core";
import { Mnemonic, UserSigner } from "@multiversx/sdk-wallet";
import { IKeySigner, getSignerBech32, getAddressBech32 } from "./key_signer.js";

export const METACHAIN_SHARD_ID = 4294967295;

export type RelayerSigner = IKeySigner | UserSigner;

export interface PipelinedRelayerConfig {
  maxScanIndex?: number;
  shardsToCover?: number[];
  relayersPerShard?: number;
  maxInFlightPerRelayer?: number;
}

export interface RelayerNonceTracker {
  nextNonce: bigint;
  confirmedNonce: bigint;
  inFlightCount: number;
}

/**
 * Pipelined Multi-Shard Relayer Pool.
 * Optimized for MultiversX Sirius sub-second (0.6s) block times.
 * Derives a lean cluster of relayers (e.g. 8-10 per shard) and provides
 * sub-microsecond atomic in-memory nonce reservation to pipeline up to 250
 * transactions per relayer into the mempool with zero gaps and zero collisions.
 */
export class PipelinedRelayerPool {
  private readonly addressComputer: AddressComputer;
  private readonly shardRelayers: Map<number, RelayerSigner[]>;
  private readonly roundRobinIndex: Map<number, number>;
  private readonly nonceTrackers: Map<string, RelayerNonceTracker>;
  private readonly maxInFlightPerRelayer: number;

  constructor(options?: { maxInFlightPerRelayer?: number }) {
    this.addressComputer = new AddressComputer();
    this.shardRelayers = new Map<number, RelayerSigner[]>();
    this.roundRobinIndex = new Map<number, number>();
    this.nonceTrackers = new Map<string, RelayerNonceTracker>();
    this.maxInFlightPerRelayer = options?.maxInFlightPerRelayer ?? 250;
  }

  getShardForAddress(address: string | Address): number {
    const addr = typeof address === "string" ? Address.newFromBech32(address) : address;
    return this.addressComputer.getShardOfAddress(addr);
  }

  registerRelayer(shard: number, signer: RelayerSigner, startingNonce: bigint = 0n): void {
    const list = this.shardRelayers.get(shard) || [];
    const addr = getSignerBech32(signer);
    if (!list.some((s) => getSignerBech32(s) === addr)) {
      list.push(signer);
      this.shardRelayers.set(shard, list);
      if (!this.nonceTrackers.has(addr)) {
        this.nonceTrackers.set(addr, {
          nextNonce: startingNonce,
          confirmedNonce: startingNonce,
          inFlightCount: 0,
        });
      }
    }
  }

  reserveNonce(address: string): bigint {
    const tracker = this.nonceTrackers.get(address);
    if (!tracker) {
      throw new Error(`Relayer address ${address} not registered in pipelined pool`);
    }
    const nonce = tracker.nextNonce;
    tracker.nextNonce += 1n;
    tracker.inFlightCount += 1;
    return nonce;
  }

  confirmNonce(address: string, nonce: bigint): void {
    const tracker = this.nonceTrackers.get(address);
    if (tracker) {
      if (nonce >= tracker.confirmedNonce) {
        tracker.confirmedNonce = nonce + 1n;
      }
      tracker.inFlightCount = Math.max(0, tracker.inFlightCount - 1);
    }
  }

  resyncNonce(address: string, onChainNonce: bigint): void {
    let tracker = this.nonceTrackers.get(address);
    if (!tracker) {
      tracker = { nextNonce: onChainNonce, confirmedNonce: onChainNonce, inFlightCount: 0 };
      this.nonceTrackers.set(address, tracker);
    } else {
      tracker.nextNonce = onChainNonce > tracker.nextNonce ? onChainNonce : tracker.nextNonce;
      tracker.confirmedNonce = onChainNonce;
      tracker.inFlightCount = Number(tracker.nextNonce - tracker.confirmedNonce);
    }
  }

  getInFlightCount(address: string): number {
    return this.nonceTrackers.get(address)?.inFlightCount ?? 0;
  }

  canAcceptTransaction(address: string, maxInFlight?: number): boolean {
    const limit = maxInFlight ?? this.maxInFlightPerRelayer;
    return this.getInFlightCount(address) < limit;
  }

  getRelayerForShard(shard: number): RelayerSigner {
    const list = this.shardRelayers.get(shard);
    if (!list || list.length === 0) {
      throw new Error(`No relayer registered for shard ${shard}`);
    }
    return list[0];
  }

  getNextRelayerForShard(shard: number): RelayerSigner {
    const list = this.shardRelayers.get(shard);
    if (!list || list.length === 0) {
      throw new Error(`No relayer registered for shard ${shard}`);
    }
    const idx = this.roundRobinIndex.get(shard) ?? 0;
    const signer = list[idx % list.length];
    this.roundRobinIndex.set(shard, (idx + 1) % list.length);
    return signer;
  }

  getAllRelayersForShard(shard: number): RelayerSigner[] {
    return this.shardRelayers.get(shard) || [];
  }

  getRelayerByAddress(address: string | Address): RelayerSigner | undefined {
    const target = getAddressBech32(address);

    for (const list of this.shardRelayers.values()) {
      const match = list.find((s) => getSignerBech32(s) === target);
      if (match) return match;
    }
    return undefined;
  }

  getAllRelayers(): RelayerSigner[] {
    const all: RelayerSigner[] = [];
    for (const list of this.shardRelayers.values()) {
      for (const s of list) {
        if (!all.some((a) => getSignerBech32(a) === getSignerBech32(s))) {
          all.push(s);
        }
      }
    }
    return all;
  }

  static fromMnemonic(mnemonicStr: string, options?: PipelinedRelayerConfig): PipelinedRelayerPool {
    const pool = new PipelinedRelayerPool({
      maxInFlightPerRelayer: options?.maxInFlightPerRelayer ?? 250,
    });
    const mnemonic = Mnemonic.fromString(mnemonicStr.trim());
    const maxScan = options?.maxScanIndex ?? 120;
    const shardsToCover = options?.shardsToCover ?? [0, 1, 2];
    const relayersPerShard = options?.relayersPerShard ?? 8;

    const counts = new Map<number, number>();
    for (const s of shardsToCover) counts.set(s, 0);

    for (let i = 0; i < maxScan; i++) {
      const allDone = shardsToCover.every((s) => (counts.get(s) ?? 0) >= relayersPerShard);
      if (allDone) break;

      const secretKey = mnemonic.deriveKey(i);
      const signer = new UserSigner(secretKey);
      const addr = Address.newFromBech32(signer.getAddress().bech32());
      const shard = pool.getShardForAddress(addr);

      if (shardsToCover.includes(shard) && (counts.get(shard) ?? 0) < relayersPerShard) {
        pool.registerRelayer(shard, signer);
        counts.set(shard, (counts.get(shard) ?? 0) + 1);
      }
    }

    // Fallback if not all reached target in maxScan: duplicate/wrap to satisfy requirement
    for (const s of shardsToCover) {
      const list = pool.getAllRelayersForShard(s);
      if (list.length === 0) {
        const fallbackSigner = new UserSigner(mnemonic.deriveKey(0));
        pool.registerRelayer(s, fallbackSigner);
      }
      while (pool.getAllRelayersForShard(s).length < relayersPerShard) {
        const existing = pool.getAllRelayersForShard(s);
        pool.registerRelayer(s, existing[0]);
      }
    }

    return pool;
  }
}
