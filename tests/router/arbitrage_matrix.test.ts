import { describe, it, expect } from "vitest";
import { ArbitrageMatrix } from "../../src/router/arbitrage_matrix.js";

describe("ArbitrageMatrix (TDD)", () => {
  it("should rank providers according to cost-optimized strategy", () => {
    const matrix = new ArbitrageMatrix();
    matrix.registerProvider({
      id: "groq-fast",
      name: "Groq LPU",
      endpoint: "https://api.groq.com",
      costPerMillionInputTokensUsd: 0.5,
      costPerMillionOutputTokensUsd: 0.8,
      avgTtftMs: 95,
      tokensPerSecond: 280,
      healthy: true,
      supportedModels: ["llama-3.3-70b", "deepseek-r1"],
    });

    matrix.registerProvider({
      id: "deepinfra-cheap",
      name: "DeepInfra Spot",
      endpoint: "https://api.deepinfra.com",
      costPerMillionInputTokensUsd: 0.15,
      costPerMillionOutputTokensUsd: 0.25,
      avgTtftMs: 250,
      tokensPerSecond: 90,
      healthy: true,
      supportedModels: ["llama-3.3-70b", "deepseek-r1"],
    });

    const ranked = matrix.getRankedProviders("llama-3.3-70b", "cost-optimized");
    expect(ranked.length).toBe(2);
    expect(ranked[0].id).toBe("deepinfra-cheap");
    expect(ranked[1].id).toBe("groq-fast");
  });

  it("should rank providers according to latency-optimized strategy", () => {
    const matrix = new ArbitrageMatrix();
    matrix.registerProvider({
      id: "groq-fast",
      name: "Groq LPU",
      endpoint: "https://api.groq.com",
      costPerMillionInputTokensUsd: 0.5,
      costPerMillionOutputTokensUsd: 0.8,
      avgTtftMs: 95,
      tokensPerSecond: 280,
      healthy: true,
      supportedModels: ["llama-3.3-70b"],
    });

    matrix.registerProvider({
      id: "deepinfra-cheap",
      name: "DeepInfra Spot",
      endpoint: "https://api.deepinfra.com",
      costPerMillionInputTokensUsd: 0.15,
      costPerMillionOutputTokensUsd: 0.25,
      avgTtftMs: 250,
      tokensPerSecond: 90,
      healthy: true,
      supportedModels: ["llama-3.3-70b"],
    });

    const ranked = matrix.getRankedProviders("llama-3.3-70b", "latency-optimized");
    expect(ranked[0].id).toBe("groq-fast");
  });

  it("should automatically exclude unhealthy providers", () => {
    const matrix = new ArbitrageMatrix();
    matrix.registerProvider({
      id: "failing-node",
      name: "Bad Node",
      endpoint: "https://bad.node",
      costPerMillionInputTokensUsd: 0.01,
      costPerMillionOutputTokensUsd: 0.01,
      avgTtftMs: 50,
      tokensPerSecond: 100,
      healthy: false,
      supportedModels: ["llama-3.3-70b"],
    });

    const ranked = matrix.getRankedProviders("llama-3.3-70b", "cost-optimized");
    expect(ranked.length).toBe(0);
  });

  it("should dynamically update spot pricing and re-rank providers", () => {
    const matrix = new ArbitrageMatrix();
    matrix.registerProvider({
      id: "groq-fast",
      name: "Groq LPU",
      endpoint: "https://api.groq.com",
      costPerMillionInputTokensUsd: 0.5,
      costPerMillionOutputTokensUsd: 0.8,
      avgTtftMs: 95,
      tokensPerSecond: 280,
      healthy: true,
      supportedModels: ["llama-3.3-70b"],
    });

    matrix.registerProvider({
      id: "deepinfra-cheap",
      name: "DeepInfra Spot",
      endpoint: "https://api.deepinfra.com",
      costPerMillionInputTokensUsd: 0.15,
      costPerMillionOutputTokensUsd: 0.25,
      avgTtftMs: 250,
      tokensPerSecond: 90,
      healthy: true,
      supportedModels: ["llama-3.3-70b"],
    });

    // Initially deepinfra is cheaper
    let ranked = matrix.getRankedProviders("llama-3.3-70b", "cost-optimized");
    expect(ranked[0].id).toBe("deepinfra-cheap");

    // Ingest dynamic spot price surge for deepinfra and price drop for groq
    const successGroq = matrix.updateSpotPricing("groq-fast", {
      costPerMillionInputTokensUsd: 0.05,
      costPerMillionOutputTokensUsd: 0.05,
    });
    const successDeepInfra = matrix.updateSpotPricing("deepinfra-cheap", {
      costPerMillionInputTokensUsd: 1.5,
      costPerMillionOutputTokensUsd: 2.5,
    });

    expect(successGroq).toBe(true);
    expect(successDeepInfra).toBe(true);

    ranked = matrix.getRankedProviders("llama-3.3-70b", "cost-optimized");
    expect(ranked[0].id).toBe("groq-fast");
  });

  it("should ingest batch spot pricing feed and report errors for missing providers", () => {
    const matrix = new ArbitrageMatrix();
    matrix.registerProvider({
      id: "provider-1",
      name: "Provider 1",
      endpoint: "https://p1",
      costPerMillionInputTokensUsd: 1.0,
      costPerMillionOutputTokensUsd: 1.0,
      avgTtftMs: 100,
      tokensPerSecond: 50,
      healthy: true,
      supportedModels: ["model-a"],
    });

    const result = matrix.ingestSpotPricingFeed([
      { id: "provider-1", costPerMillionInputTokensUsd: 0.2, tokensPerSecond: 120 },
      { id: "non-existent-provider", costPerMillionInputTokensUsd: 0.1 },
    ]);

    expect(result.updatedCount).toBe(1);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("Provider not found: non-existent-provider");

    const p1 = matrix.getProvider("provider-1");
    expect(p1?.costPerMillionInputTokensUsd).toBe(0.2);
    expect(p1?.tokensPerSecond).toBe(120);
  });
});
