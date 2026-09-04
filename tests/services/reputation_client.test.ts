import { describe, it, expect, vi } from "vitest";
import { ReputationClient } from "../../src/services/reputation_client.js";

describe("ReputationClient (TDD)", () => {
  it("should submit simple feedback for a completed job", async () => {
    const mockGiveFeedbackSimple = vi.fn().mockResolvedValue("tx-feedback-123");

    const client = new ReputationClient({
      reputationContractAddress: "erd1qqqqqqqqqqqqqpgqfeedback000000000000000000000000000000000",
      giveFeedbackSimpleFn: mockGiveFeedbackSimple,
    });

    const txHash = await client.giveFeedbackSimple("job-101", 42, 95);
    expect(txHash).toBe("tx-feedback-123");
    expect(mockGiveFeedbackSimple).toHaveBeenCalledWith("job-101", 42, 95);
  });

  it("should query agent reputation score", async () => {
    const mockGetScore = vi.fn().mockResolvedValue(94.5);

    const client = new ReputationClient({
      getScoreFn: mockGetScore,
    });

    const score = await client.getReputationScore(42);
    expect(score).toBe(94.5);
    expect(mockGetScore).toHaveBeenCalledWith(42);
  });

  it("should reject rating outside 1..100 range", async () => {
    const client = new ReputationClient({});
    await expect(client.giveFeedbackSimple("job-1", 42, 105)).rejects.toThrow("1 and 100");
    await expect(client.giveFeedbackSimple("job-1", 42, 0)).rejects.toThrow("1 and 100");
  });
});
