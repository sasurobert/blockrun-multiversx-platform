import { describe, it, expect, vi } from "vitest";
import { SlaSlasher } from "../../src/router/sla_slasher.js";
import { ArbitrageMatrix } from "../../src/router/arbitrage_matrix.js";

describe("SlaSlasher (TDD)", () => {
  it("should detect TTFT breach and submit validation response", async () => {
    const mockValidationResponse = vi.fn().mockResolvedValue("tx-slash-hash-1");
    const matrix = new ArbitrageMatrix();
    matrix.registerProvider({
      id: "slow-node",
      name: "Slow Node",
      endpoint: "https://slow",
      costPerMillionInputTokensUsd: 0.1,
      costPerMillionOutputTokensUsd: 0.1,
      avgTtftMs: 500,
      tokensPerSecond: 10,
      healthy: true,
      supportedModels: ["llama-3.3-70b"],
    });

    const slasher = new SlaSlasher({
      matrix,
      maxAllowedTtftMs: 1500,
      validationResponseFn: mockValidationResponse,
    });

    const tx = await slasher.reportTtft("slow-node", 2000, "req-hash-abc");
    expect(tx).toBe("tx-slash-hash-1");
    expect(mockValidationResponse).toHaveBeenCalledWith("req-hash-abc", 0, "SLA_BREACH");

    // Provider should be marked unhealthy in matrix
    expect(matrix.getProvider("slow-node")?.healthy).toBe(false);
  });

  it("should not slash provider if TTFT is within acceptable limits", async () => {
    const mockValidationResponse = vi.fn();
    const matrix = new ArbitrageMatrix();
    matrix.registerProvider({
      id: "fast-node",
      name: "Fast Node",
      endpoint: "https://fast",
      costPerMillionInputTokensUsd: 0.1,
      costPerMillionOutputTokensUsd: 0.1,
      avgTtftMs: 100,
      tokensPerSecond: 100,
      healthy: true,
      supportedModels: ["llama-3.3-70b"],
    });

    const slasher = new SlaSlasher({
      matrix,
      maxAllowedTtftMs: 1500,
      validationResponseFn: mockValidationResponse,
    });

    const tx = await slasher.reportTtft("fast-node", 250, "req-hash-xyz");
    expect(tx).toBeUndefined();
    expect(mockValidationResponse).not.toHaveBeenCalled();
    expect(matrix.getProvider("fast-node")?.healthy).toBe(true);
  });
});
