import { describe, it, expect } from "vitest";
import { MerchantPoolManager, DEFAULT_SHARD_MERCHANTS } from "../../src/services/merchant_pool";

describe("MerchantPoolManager", () => {
  const manager = new MerchantPoolManager();

  it("should initialize with 3 shard-aligned merchants", () => {
    const merchants = manager.getAllMerchants();
    expect(merchants).toHaveLength(3);
    expect(merchants.map((m) => m.shard)).toEqual([0, 1, 2]);
  });

  it("should return the correct merchant for Shard 0, 1, and 2", () => {
    expect(manager.getMerchantAddressForShard(0)).toBe(DEFAULT_SHARD_MERCHANTS[0]);
    expect(manager.getMerchantAddressForShard(1)).toBe(DEFAULT_SHARD_MERCHANTS[1]);
    expect(manager.getMerchantAddressForShard(2)).toBe(DEFAULT_SHARD_MERCHANTS[2]);
  });

  it("should compute shard of valid Bech32 address accurately", () => {
    // Shard 0 address
    const shard0User = "erd1n2tunlzeqdezy3nz4cdz0a2r056wlsrdew8atsmst7cpd2l0fjxqsgrc6a";
    expect(manager.getShardOfAddress(shard0User)).toBe(0);

    // Shard 1 address
    const shard1User = "erd123g08w7g2p9qxynfhplxukearq68uyqn2fvepyyf33pd40ea95as02yv3k";
    expect(manager.getShardOfAddress(shard1User)).toBe(1);
  });

  it("should resolve shard-matched merchant for user", () => {
    const shard0User = "erd1n2tunlzeqdezy3nz4cdz0a2r056wlsrdew8atsmst7cpd2l0fjxqsgrc6a";
    const res = manager.getMerchantAddressForUser(shard0User);
    expect(res.shard).toBe(0);
    expect(res.merchantAddress).toBe(DEFAULT_SHARD_MERCHANTS[0]);
  });
});
