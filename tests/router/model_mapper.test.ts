import { describe, it, expect } from "vitest";
import { ModelMapper } from "../../src/router/model_mapper.js";
import { ArbitrageMatrix } from "../../src/router/arbitrage_matrix.js";

describe("ModelMapper (TDD)", () => {
  const matrix = new ArbitrageMatrix();
  matrix.registerProvider({
    id: "groq-fast",
    name: "Groq",
    endpoint: "https://groq",
    costPerMillionInputTokensUsd: 0.59,
    costPerMillionOutputTokensUsd: 0.79,
    avgTtftMs: 90,
    tokensPerSecond: 280,
    healthy: true,
    supportedModels: ["deepseek-r1-distill-llama-70b", "llama-3.3-70b"],
  });

  const mapper = new ModelMapper(matrix);

  it("should resolve auto:reasoning to lowest spot reasoning model", () => {
    const resolution = mapper.resolveModel("auto:reasoning");
    expect(resolution.alias).toBe("auto:reasoning");
    expect(resolution.resolvedModel).toBe("deepseek-r1-distill-llama-70b");
    expect(resolution.providerId).toBe("groq-fast");
    expect(resolution.estimatedMicroUsdc).toBeDefined();
  });

  it("should resolve concrete model names directly", () => {
    const resolution = mapper.resolveModel("llama-3.3-70b");
    expect(resolution.resolvedModel).toBe("llama-3.3-70b");
    expect(resolution.providerId).toBe("groq-fast");
  });

  it("should fallback to default if model is unmapped", () => {
    const resolution = mapper.resolveModel("unknown-model");
    expect(resolution.resolvedModel).toBeDefined();
  });
});
