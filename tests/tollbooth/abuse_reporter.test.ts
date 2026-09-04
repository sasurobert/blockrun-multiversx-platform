import { describe, it, expect, vi } from "vitest";
import { AbuseReporter } from "../../src/tollbooth/abuse_reporter.js";
import { ReputationClient } from "../../src/services/reputation_client.js";

describe("AbuseReporter (TDD)", () => {
  it("should record failures and submit on-chain report when threshold is exceeded", async () => {
    const mockGiveFeedback = vi.fn().mockResolvedValue("tx-abuse-report-hash");
    const repClient = new ReputationClient({
      giveFeedbackFn: mockGiveFeedback,
    });

    const reporter = new AbuseReporter({
      reputationClient: repClient,
      failureThreshold: 3,
    });

    const agentNonce = 42;
    const ip = "192.168.1.100";

    // 1st failure
    await reporter.recordFailure(ip, agentNonce);
    expect(mockGiveFeedback).not.toHaveBeenCalled();

    // 2nd failure
    await reporter.recordFailure(ip, agentNonce);
    expect(mockGiveFeedback).not.toHaveBeenCalled();

    // 3rd failure -> triggers report!
    const tx = await reporter.recordFailure(ip, agentNonce);
    expect(tx).toBe("tx-abuse-report-hash");
    expect(mockGiveFeedback).toHaveBeenCalledTimes(1);
    expect(mockGiveFeedback).toHaveBeenCalledWith(
      42,
      -100,
      2,
      "abuse/dos",
      "invalid_signature_flood",
      expect.any(String),
      expect.any(String),
      expect.any(String)
    );
  });
});
