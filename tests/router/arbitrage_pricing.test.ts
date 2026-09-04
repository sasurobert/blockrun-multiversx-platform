import { describe, it, expect } from "vitest";
import { ArbitragePricingEngine } from "../../src/router/arbitrage_pricing.js";
import { ProviderSpec } from "../../src/router/types.js";

describe("ArbitragePricingEngine (TDD)", () => {
  const engine = new ArbitragePricingEngine({
    marginPercent: 10,
    flatFeeMicroUsdc: 1000,
  });

  const provider: ProviderSpec = {
    id: "groq-fast",
    name: "Groq",
    endpoint: "https://groq",
    costPerMillionInputTokensUsd: 0.5,
    costPerMillionOutputTokensUsd: 0.8,
    avgTtftMs: 90,
    tokensPerSecond: 250,
    healthy: true,
    supportedModels: ["llama-3.3-70b"],
  };

  it("should calculate exact dynamic price with 10% margin and 1000 micro-USDC flat fee", () => {
    // 10,000 input tokens: 10,000 * 0.5 / 1M = $0.005000 (5,000 micro-USDC)
    // 1,000 output tokens: 1,000 * 0.8 / 1M = $0.000800 (800 micro-USDC)
    // Base cost: 5,800 micro-USDC
    // 10% margin: 580 micro-USDC
    // Flat fee: 1,000 micro-USDC
    // Total: 7,380 micro-USDC ($0.007380)
    const pricing = engine.calculatePrice({
      provider,
      inputTokens: 10_000,
      outputTokens: 1_000,
    });

    expect(pricing.microUsdc).toBe("7380");
    expect(pricing.usdFormatted).toBe("$0.007380");
    expect(pricing.marginMicroUsdc).toBe("580");
    expect(pricing.flatFeeMicroUsdc).toBe("1000");
  });
});
