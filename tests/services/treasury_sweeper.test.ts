import { describe, it, expect } from "vitest";
import { TreasurySweeperService } from "../../src/services/treasury_sweeper";
import { MerchantPoolManager } from "../../src/services/merchant_pool";

describe("TreasurySweeperService", () => {
  const merchantPool = new MerchantPoolManager();
  const sweeper = new TreasurySweeperService({
    merchantPool,
    masterTreasuryAddress: "erd1mastertreasuryaddress0000000000000000000000000000000000000",
    tokenId: "USDC-350c4e",
  });

  it("should return treasury status across all 3 shards", async () => {
    const status = await sweeper.getTreasuryStatus();
    expect(status.shards).toHaveLength(3);
    expect(status.masterTreasuryAddress).toBe("erd1mastertreasuryaddress0000000000000000000000000000000000000");
    expect(status.shards.map((s) => s.shard)).toEqual([0, 1, 2]);
  });

  it("should trigger asynchronous consolidation sweep", async () => {
    const res = await sweeper.triggerSweep();
    expect(res.success).toBe(true);
    expect(typeof res.timestamp).toBe("string");
  });
});
