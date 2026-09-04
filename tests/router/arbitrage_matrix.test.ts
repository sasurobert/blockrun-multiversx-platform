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
});
