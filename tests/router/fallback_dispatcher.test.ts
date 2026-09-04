import { describe, it, expect, vi } from "vitest";
import { CascadingFallbackDispatcher } from "../../src/router/fallback_dispatcher.js";
import { ProviderSpec } from "../../src/router/types.js";

describe("CascadingFallbackDispatcher (TDD)", () => {
  const primaryProvider: ProviderSpec = {
    id: "groq-fast",
    name: "Groq",
    endpoint: "https://groq",
    costPerMillionInputTokensUsd: 0.5,
    costPerMillionOutputTokensUsd: 0.8,
    avgTtftMs: 100,
    tokensPerSecond: 250,
    healthy: true,
    supportedModels: ["llama-3.3-70b"],
  };

  const fallbackProvider: ProviderSpec = {
    id: "together-spot",
    name: "Together",
    endpoint: "https://together",
    costPerMillionInputTokensUsd: 0.4,
    costPerMillionOutputTokensUsd: 0.7,
    avgTtftMs: 200,
    tokensPerSecond: 120,
    healthy: true,
    supportedModels: ["llama-3.3-70b"],
  };

  it("should stream from primary when primary responds within fallback timeout", async () => {
    const mockExecutor = vi.fn().mockImplementation(async function* (provider: ProviderSpec) {
      yield `Chunk 1 from ${provider.id}`;
      yield `Chunk 2 from ${provider.id}`;
    });

    const dispatcher = new CascadingFallbackDispatcher({
      fallbackTimeoutMs: 500,
      streamExecutor: mockExecutor,
    });

    const result = await dispatcher.dispatch([primaryProvider, fallbackProvider], {
      model: "llama-3.3-70b",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.fallbackOccurred).toBe(false);
    expect(result.providerId).toBe("groq-fast");

    const chunks: string[] = [];
    for await (const chunk of result.stream) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["Chunk 1 from groq-fast", "Chunk 2 from groq-fast"]);
    expect(mockExecutor).toHaveBeenCalledTimes(1);
  });

  it("should automatically fallback to secondary provider when primary stalls or fails", async () => {
    const mockExecutor = vi.fn().mockImplementation(async function* (provider: ProviderSpec) {
      if (provider.id === "groq-fast") {
        // Simulate stall longer than fallbackTimeoutMs
        await new Promise((resolve) => setTimeout(resolve, 300));
        yield "Late chunk";
      } else {
        yield `Fallback chunk from ${provider.id}`;
      }
    });

    const dispatcher = new CascadingFallbackDispatcher({
      fallbackTimeoutMs: 50, // Short timeout for test
      streamExecutor: mockExecutor,
    });

    const result = await dispatcher.dispatch([primaryProvider, fallbackProvider], {
      model: "llama-3.3-70b",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.fallbackOccurred).toBe(true);
    expect(result.providerId).toBe("together-spot");

    const chunks: string[] = [];
    for await (const chunk of result.stream) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["Fallback chunk from together-spot"]);
  });
});
