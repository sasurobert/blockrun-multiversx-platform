import { Address, AddressComputer } from "@multiversx/sdk-core";
import { Mnemonic, parseUserKeys, UserSecretKey, UserSigner } from "@multiversx/sdk-wallet";
import { IKeySigner, LocalKeySigner, getSignerBech32, getAddressBech32 } from "./key_signer.js";

/**
 * MultiversX Metachain shard identifier.
 */
export const METACHAIN_SHARD_ID = 4294967295;

/**
 * Supported relayer signer type: either native UserSigner or KeySigner abstraction.
 */
export type RelayerSigner = IKeySigner | UserSigner;

/**
 * Options for configuring relayer discovery from mnemonic.
 */
export interface MnemonicRelayerOptions {
  maxScanIndex?: number;
  shardsToCover?: number[];
  relayersPerShard?: number;
}

/**
 * Multi-Shard Relayer Pool Manager.
 * Computes shard IDs for user addresses and manages relayer signers across shards (0, 1, 2, Metachain)
 * with support for multiple rotated relayers per shard to maximize throughput.
 */
export class RelayerPoolManager {
  private readonly addressComputer: AddressComputer;
  private readonly shardRelayers: Map<number, RelayerSigner[]>;
  private readonly roundRobinIndex: Map<number, number>;

  constructor(relayers?: Map<number, RelayerSigner | RelayerSigner[]> | Record<number, RelayerSigner | RelayerSigner[]>) {
    this.addressComputer = new AddressComputer();
    this.shardRelayers = new Map<number, RelayerSigner[]>();
    this.roundRobinIndex = new Map<number, number>();

    if (relayers) {
      if (relayers instanceof Map) {
        for (const [shard, signerOrList] of relayers.entries()) {
          const list = Array.isArray(signerOrList) ? signerOrList : [signerOrList];
          for (const s of list) {
            this.registerRelayer(shard, s);
          }
        }
      } else {
        for (const [shardStr, signerOrList] of Object.entries(relayers)) {
          const shard = Number(shardStr);
          const list = Array.isArray(signerOrList) ? signerOrList : [signerOrList];
          for (const s of list) {
            this.registerRelayer(shard, s);
          }
        }
      }
    }
  }

  /**
   * Computes the shard ID for any MultiversX address (string or Address instance).
   */
  getShardForAddress(address: string | Address): number {
    const addr = typeof address === "string" ? Address.newFromBech32(address) : address;
    return this.addressComputer.getShardOfAddress(addr);
  }

  /**
   * Registers a relayer signer for a specific shard.
   */
  registerRelayer(shard: number, signer: RelayerSigner): void {
    const list = this.shardRelayers.get(shard) || [];
    const signerAddr = getSignerBech32(signer);
    // Avoid duplicate registration of the same relayer address
    if (!list.some((s) => getSignerBech32(s) === signerAddr)) {
      list.push(signer);
      this.shardRelayers.set(shard, list);
    }
  }

  /**
   * Registers a relayer signer by computing its shard automatically.
   */
  registerRelayerAuto(signer: RelayerSigner): number {
    const shard = this.getShardForAddress(getSignerBech32(signer));
    this.registerRelayer(shard, signer);
    return shard;
  }

  /**
   * Checks if a relayer is registered for the specified shard.
   */
  hasShard(shard: number): boolean {
    return (this.shardRelayers.get(shard)?.length ?? 0) > 0;
  }

  /**
   * Returns the primary (first) relayer signer for the given shard.
   */
  getRelayerForShard(shard: number): RelayerSigner {
    const list = this.shardRelayers.get(shard);
    if (!list || list.length === 0) {
      throw new Error(`No relayer configured for shard ${shard}`);
    }
    return list[0];
  }

  /**
   * Returns the next relayer signer for the given shard using round-robin rotation.
   */
  getNextRelayerForShard(shard: number): RelayerSigner {
    const list = this.shardRelayers.get(shard);
    if (!list || list.length === 0) {
      throw new Error(`No relayer configured for shard ${shard}`);
    }

    const currentIndex = this.roundRobinIndex.get(shard) ?? 0;
    const selected = list[currentIndex % list.length];
    this.roundRobinIndex.set(shard, currentIndex + 1);
    return selected;
  }

  /**
   * Returns all registered relayer signers for the given shard.
   */
  getAllRelayersForShard(shard: number): RelayerSigner[] {
    return [...(this.shardRelayers.get(shard) || [])];
  }

  /**
   * Returns the primary bech32 address for the given shard relayer.
   */
  getRelayerAddressForShard(shard: number): string {
    const relayer = this.getRelayerForShard(shard);
    return getSignerBech32(relayer);
  }

  /**
   * Returns the next bech32 address for the given shard using round-robin rotation.
   */
  getNextRelayerAddressForShard(shard: number): string {
    const relayer = this.getNextRelayerForShard(shard);
    return getSignerBech32(relayer);
  }

  /**
   * Computes the shard of the given user address and returns a matching relayer signer (round-robin).
   */
  getRelayerForAddress(userAddress: string | Address): RelayerSigner {
    const shard = this.getShardForAddress(userAddress);
    return this.getNextRelayerForShard(shard);
  }

  /**
   * Computes the shard of the given user address and returns a matching relayer bech32 address.
   */
  getRelayerAddressForUser(userAddress: string | Address): string {
    const relayer = this.getRelayerForAddress(userAddress);
    return getSignerBech32(relayer);
  }

  /**
   * Computes the shard of the given user address and returns the next rotated relayer bech32 address.
   */
  getNextRelayerAddressForUser(userAddress: string | Address): string {
    return this.getRelayerAddressForUser(userAddress);
  }

  /**
   * Checks if a given address matches any configured relayer address across all shards.
   */
  isConfiguredRelayer(address: string | Address): boolean {
    return this.getRelayerByAddress(address) !== undefined;
  }

  /**
   * Finds and returns a configured relayer signer matching the given relayer address.
   */
  getRelayerByAddress(address: string | Address): RelayerSigner | undefined {
    const target = getAddressBech32(address);
    for (const list of this.shardRelayers.values()) {
      const match = list.find((s) => getSignerBech32(s) === target);
      if (match) {
        return match;
      }
    }
    return undefined;
  }

  /**
   * Returns a map of all primary registered relayers by shard.
   */
  getAllRelayers(): Map<number, RelayerSigner> {
    const result = new Map<number, RelayerSigner>();
    for (const [shard, list] of this.shardRelayers.entries()) {
      if (list.length > 0) {
        result.set(shard, list[0]);
      }
    }
    return result;
  }

  /**
   * Returns a record of shard ID to primary relayer bech32 address.
   */
  getAllRelayerAddresses(): Record<number, string> {
    const result: Record<number, string> = {};
    for (const [shard, list] of this.shardRelayers.entries()) {
      if (list.length > 0) {
        result[shard] = getSignerBech32(list[0]);
      }
    }
    return result;
  }

  /**
   * Returns a record of shard ID to all relayer bech32 addresses.
   */
  getAllRelayerAddressesMulti(): Record<number, string[]> {
    const result: Record<number, string[]> = {};
    for (const [shard, list] of this.shardRelayers.entries()) {
      result[shard] = list.map((s) => getSignerBech32(s));
    }
    return result;
  }

  /**
   * Initializes a RelayerPoolManager from a 24-word mnemonic phrase by scanning derivation indexes.
   */
  static fromMnemonic(mnemonicStr: string, options?: MnemonicRelayerOptions): RelayerPoolManager {
    const mnemonic = Mnemonic.fromString(mnemonicStr.trim());
    const maxScanIndex = options?.maxScanIndex ?? 100;
    const targetShards = new Set<number>(options?.shardsToCover ?? [0, 1, 2]);
    const relayersPerShard = Math.max(1, options?.relayersPerShard ?? 1);

    const pool = new RelayerPoolManager();
    const ac = new AddressComputer();

    for (let i = 0; i < maxScanIndex; i++) {
      const secret = mnemonic.deriveKey(i);
      const pub = secret.generatePublicKey();
      const addr = Address.newFromBech32(pub.toAddress().bech32());
      const shard = ac.getShardOfAddress(addr);

      if (targetShards.has(shard)) {
        const count = pool.getAllRelayersForShard(shard).length;
        if (count < relayersPerShard) {
          pool.registerRelayer(shard, new UserSigner(secret));
        }
      }

      // Check if all requested shards have enough relayers
      const allFilled = Array.from(targetShards).every(
        (s) => pool.getAllRelayersForShard(s).length >= relayersPerShard
      );
      if (allFilled) {
        break;
      }
    }

    return pool;
  }

  /**
   * Initializes a RelayerPoolManager from MultiversX PEM file content.
   */
  static fromPem(pemContent: string): RelayerPoolManager {
    const secretKeys = parseUserKeys(pemContent);
    const pool = new RelayerPoolManager();

    for (const secretKey of secretKeys) {
      const signer = new UserSigner(secretKey);
      pool.registerRelayerAuto(signer);
    }

    return pool;
  }

  /**
   * Initializes a RelayerPoolManager from a dictionary of shard IDs to private keys, UserSigners, or KeySigners.
   */
  static fromPrivateKeys(
    keysByShard: Record<number, string | RelayerSigner | UserSecretKey>
  ): RelayerPoolManager {
    const pool = new RelayerPoolManager();

    for (const [shardStr, keyOrSigner] of Object.entries(keysByShard)) {
      const shard = Number(shardStr);
      if (keyOrSigner instanceof UserSigner || (keyOrSigner && typeof (keyOrSigner as any).sign === "function" && typeof (keyOrSigner as any).getAddress === "function")) {
        pool.registerRelayer(shard, keyOrSigner as RelayerSigner);
      } else if (keyOrSigner instanceof UserSecretKey) {
        pool.registerRelayer(shard, new UserSigner(keyOrSigner));
      } else if (typeof keyOrSigner === "string") {
        const secret = new UserSecretKey(Buffer.from(keyOrSigner.replace(/^0x/, ""), "hex"));
        pool.registerRelayer(shard, new UserSigner(secret));
      }
    }

    return pool;
  }
}
