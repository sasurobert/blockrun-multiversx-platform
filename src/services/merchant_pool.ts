import { Address, AddressComputer } from "@multiversx/sdk-core";

export interface ShardMerchant {
  shard: number;
  address: string;
  label: string;
}

/**
 * Standard Devnet Shard-Aligned Merchant Addresses.
 * Generated deterministically so that:
 * - Shard 0: erd1ka0yrspygvjtktyzxu58ufn0kujkqgx4gq2ch5ev2aqjcem9jcqqkntrmv
 * - Shard 1: erd17twshvk28u27agmwj7666cxa4jlua9ra5aelwzj2urqm0kwk6k6s2an6gw
 * - Shard 2: erd1047vneuds803avp9pgan4ve8ug5c9y3tn3x9c0cgxakcsjmktklqh3cy5y
 */
export const DEFAULT_SHARD_MERCHANTS: Record<number, string> = {
  0: "erd1ka0yrspygvjtktyzxu58ufn0kujkqgx4gq2ch5ev2aqjcem9jcqqkntrmv",
  1: "erd17twshvk28u27agmwj7666cxa4jlua9ra5aelwzj2urqm0kwk6k6s2an6gw",
  2: "erd1047vneuds803avp9pgan4ve8ug5c9y3tn3x9c0cgxakcsjmktklqh3cy5y",
};

/**
 * Manages shard-aligned merchant addresses to guarantee pure intra-shard
 * transactions (0.6s single-round finality) with zero cross-shard miniblock overhead.
 */
export class MerchantPoolManager {
  private readonly addressComputer: AddressComputer;
  private readonly merchantsByShard: Map<number, string>;
  private readonly defaultMerchant: string;

  constructor(merchants?: Record<number, string>) {
    this.addressComputer = new AddressComputer();
    this.merchantsByShard = new Map<number, string>();

    const config = merchants || DEFAULT_SHARD_MERCHANTS;

    for (const [shardStr, addr] of Object.entries(config)) {
      this.merchantsByShard.set(Number(shardStr), addr);
    }

    this.defaultMerchant = this.merchantsByShard.get(0) || Object.values(config)[0];
  }

  /**
   * Computes the shard ID (0, 1, 2) for any Bech32 address.
   */
  public getShardOfAddress(addressBech32: string): number {
    try {
      return this.addressComputer.getShardOfAddress(Address.newFromBech32(addressBech32));
    } catch {
      return 0; // Default to shard 0 if unparseable
    }
  }

  /**
   * Returns the merchant address matching the specified shard.
   */
  public getMerchantAddressForShard(shard: number): string {
    return this.merchantsByShard.get(shard) || this.defaultMerchant;
  }

  /**
   * Resolves the payer's shard and returns the corresponding shard-aligned merchant address.
   */
  public getMerchantAddressForUser(userAddress?: string): { merchantAddress: string; shard: number } {
    if (!userAddress) {
      return { merchantAddress: this.defaultMerchant, shard: 0 };
    }
    const shard = this.getShardOfAddress(userAddress);
    const merchantAddress = this.getMerchantAddressForShard(shard);
    return { merchantAddress, shard };
  }

  /**
   * Returns all registered shard merchants.
   */
  public getAllMerchants(): ShardMerchant[] {
    return Array.from(this.merchantsByShard.entries()).map(([shard, address]) => ({
      shard,
      address,
      label: `Merchant Shard ${shard}`,
    }));
  }
}
