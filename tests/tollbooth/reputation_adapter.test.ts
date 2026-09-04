import { describe, it, expect, vi } from "vitest";
import { TollboothReputationAdapter } from "../../src/tollbooth/reputation_adapter.js";
import { ReputationClient } from "../../src/services/reputation_client.js";

describe("TollboothReputationAdapter (TDD)", () => {
  it("should resolve agent reputation score and map to pricing discount", async () => {
    const mockRepClient = new ReputationClient({
      getScoreFn: vi.fn().mockResolvedValue(95.0),
    });

    const adapter = new TollboothReputationAdapter({
      reputationClient: mockRepClient,
    });

    const score = await adapter.getAgentScore(42);
    expect(score).toBe(95.0);

    const tier = adapter.getTier(score);
    expect(tier).toBe("vip");
  });

  it("should default to probe tier if agent is unregistered", async () => {
    const mockRepClient = new ReputationClient({
      getScoreFn: vi.fn().mockResolvedValue(0),
    });

    const adapter = new TollboothReputationAdapter({
      reputationClient: mockRepClient,
    });

    const score = await adapter.getAgentScore(undefined);
    expect(score).toBeUndefined();
    expect(adapter.getTier(score)).toBe("probe");
  });
});
