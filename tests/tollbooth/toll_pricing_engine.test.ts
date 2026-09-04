import { describe, it, expect } from "vitest";
import { TollPricingEngine } from "../../src/tollbooth/toll_pricing_engine.js";
import { MerchantPoolManager } from "../../src/services/merchant_pool.js";

describe("TollPricingEngine (TDD)", () => {
  const merchantPool = new MerchantPoolManager();
  const pricingEngine = new TollPricingEngine({
    baseTollMicroUsdc: 1000, // $0.001
    perTokenMicroUsdc: 0.5,
    merchantPool,
  });

  it("should calculate standard toll for 1,000 tokens", () => {
    const calc = pricingEngine.calculateToll({
      estimatedTokens: 1000,
      reputationScore: 75,
      clientAddress: "erd1ka0yrspygvjtktyzxu58ufn0kujkqgx4gq2ch5ev2aqjcem9jcqqkntrmv", // shard 0
    });

    // 1000 base + 1000 * 0.5 = 1500 micro-USDC ($0.0015)
    expect(calc.microUsdc).toBe("1500");
    expect(calc.usdFormatted).toBe("$0.001500");
    expect(calc.tier).toBe("standard");
    expect(calc.shard).toBe(0);
    expect(calc.merchantAddress).toBe(merchantPool.getMerchantAddressForShard(0));
  });

  it("should apply 20% VIP discount for high reputation agents (>= 90)", () => {
    const calc = pricingEngine.calculateToll({
      estimatedTokens: 1000,
      reputationScore: 95,
      clientAddress: "erd17twshvk28u27agmwj7666cxa4jlua9ra5aelwzj2urqm0kwk6k6s2an6gw", // shard 1
    });

    // 1500 - 20% = 1200 micro-USDC ($0.0012)
    expect(calc.microUsdc).toBe("1200");
    expect(calc.usdFormatted).toBe("$0.001200");
    expect(calc.tier).toBe("vip");
    expect(calc.shard).toBe(1);
    expect(calc.merchantAddress).toBe(merchantPool.getMerchantAddressForShard(1));
  });

  it("should apply probe rate (2x) for unregistered or low reputation crawlers", () => {
    const calc = pricingEngine.calculateToll({
      estimatedTokens: 1000,
      reputationScore: 30,
    });

    // 1500 * 2 = 3000 micro-USDC ($0.0030)
    expect(calc.microUsdc).toBe("3000");
    expect(calc.tier).toBe("probe");
  });
});
