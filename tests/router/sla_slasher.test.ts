import { describe, it, expect, vi } from "vitest";
import { SlaSlasher } from "../../src/router/sla_slasher.js";
import { ArbitrageMatrix } from "../../src/router/arbitrage_matrix.js";
import { ReputationClient } from "../../src/services/reputation_client.js";

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

  it("should submit negative feedback to Devnet ReputationRegistry on TTFT breach", async () => {
    const matrix = new ArbitrageMatrix();
    matrix.registerProvider({
      id: "laggy-provider",
      name: "Laggy Provider",
      endpoint: "https://laggy",
      costPerMillionInputTokensUsd: 0.1,
      costPerMillionOutputTokensUsd: 0.1,
      avgTtftMs: 600,
      tokensPerSecond: 15,
      healthy: true,
      supportedModels: ["llama-3.3-70b"],
    });

    const mockFeedbackFn = vi.fn().mockResolvedValue("reputation-tx-12345");
    const repClient = new ReputationClient({
      giveFeedbackSimpleFn: mockFeedbackFn,
    });

    const slasher = new SlaSlasher({
      matrix,
      maxAllowedTtftMs: 1000,
      reputationClient: repClient,
      providerAgentNonceMap: {
        "laggy-provider": 42,
      },
    });

    const tx = await slasher.reportTtft("laggy-provider", 1200, "req-123");
    expect(tx).toBe("reputation-tx-12345");
    expect(mockFeedbackFn).toHaveBeenCalledWith("req-123", 42, 1);
    expect(matrix.getProvider("laggy-provider")?.healthy).toBe(false);
  });

  it("should slash provider on consecutive failures exceeding limit", async () => {
    const matrix = new ArbitrageMatrix();
    matrix.registerProvider({
      id: "flaky-provider",
      name: "Flaky Provider",
      endpoint: "https://flaky",
      costPerMillionInputTokensUsd: 0.1,
      costPerMillionOutputTokensUsd: 0.1,
      avgTtftMs: 200,
      tokensPerSecond: 50,
      healthy: true,
      supportedModels: ["llama-3.3-70b"],
    });

    const mockFeedbackFn = vi.fn().mockResolvedValue("reputation-tx-fail-slash");
    const repClient = new ReputationClient({
      giveFeedbackSimpleFn: mockFeedbackFn,
    });

    const slasher = new SlaSlasher({
      matrix,
      consecutiveFailureLimit: 3,
      reputationClient: repClient,
      providerAgentNonceMap: new Map([["flaky-provider", 99]]),
    });

    // 1st failure - below limit
    const res1 = await slasher.reportFailure("flaky-provider", "req-f1");
    expect(res1).toBeUndefined();
    expect(mockFeedbackFn).not.toHaveBeenCalled();
    expect(matrix.getProvider("flaky-provider")?.healthy).toBe(true);

    // 2nd failure - below limit
    const res2 = await slasher.reportFailure("flaky-provider", "req-f2");
    expect(res2).toBeUndefined();
    expect(mockFeedbackFn).not.toHaveBeenCalled();

    // 3rd failure - hits limit!
    const res3 = await slasher.reportFailure("flaky-provider", "req-f3");
    expect(res3).toBe("reputation-tx-fail-slash");
    expect(mockFeedbackFn).toHaveBeenCalledWith("req-f3", 99, 1);
    expect(matrix.getProvider("flaky-provider")?.healthy).toBe(false);
  });

  it("should reset consecutive failure counter on healthy TTFT report and avoid false-positive slashing", async () => {
    const matrix = new ArbitrageMatrix();
    matrix.registerProvider({
      id: "recovering-node",
      name: "Recovering Node",
      endpoint: "https://recover",
      costPerMillionInputTokensUsd: 0.1,
      costPerMillionOutputTokensUsd: 0.1,
      avgTtftMs: 200,
      tokensPerSecond: 50,
      healthy: true,
      supportedModels: ["llama-3.3-70b"],
    });

    const mockFeedbackFn = vi.fn().mockResolvedValue("rep-tx");
    const repClient = new ReputationClient({ giveFeedbackSimpleFn: mockFeedbackFn });

    const slasher = new SlaSlasher({
      matrix,
      consecutiveFailureLimit: 3,
      reputationClient: repClient,
      providerAgentNonceMap: { "recovering-node": 55 },
    });

    // 2 consecutive failures
    await slasher.reportFailure("recovering-node", "req-1");
    await slasher.reportFailure("recovering-node", "req-2");
    expect(mockFeedbackFn).not.toHaveBeenCalled();

    // 1 healthy response resets count
    await slasher.reportTtft("recovering-node", 150, "req-3");

    // Next failure should be count 1, NOT count 3 -> should NOT trigger slashing
    const res = await slasher.reportFailure("recovering-node", "req-4");
    expect(res).toBeUndefined();
    expect(mockFeedbackFn).not.toHaveBeenCalled();
    expect(matrix.getProvider("recovering-node")?.healthy).toBe(true);
  });
});


