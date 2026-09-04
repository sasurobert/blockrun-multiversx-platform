import { describe, it, expect, vi } from "vitest";
import { NodeRegistryAdapter } from "../../src/router/node_registry_adapter.js";

describe("NodeRegistryAdapter (TDD)", () => {
  it("should query node identity and verify collateral stake", async () => {
    const mockQueryNode = vi.fn().mockResolvedValue({
      agentNonce: 12,
      owner: "erd1node000000000000000000000000000000000000000000000000000000",
      stakedAmount: "100000000000000000000", // 100 EGLD
      models: ["llama-3.3-70b", "deepseek-r1"],
      minStakeRequired: "50000000000000000000", // 50 EGLD
    });

    const adapter = new NodeRegistryAdapter({
      queryNodeFn: mockQueryNode,
    });

    const node = await adapter.getNodeInfo(12);
    expect(node).toBeDefined();
    expect(node?.isStaked).toBe(true);
    expect(node?.models).toContain("llama-3.3-70b");
  });

  it("should mark node as unstaked if stake is below threshold", async () => {
    const mockQueryNode = vi.fn().mockResolvedValue({
      agentNonce: 15,
      owner: "erd1poor000000000000000000000000000000000000000000000000000000",
      stakedAmount: "10000000000000000000", // 10 EGLD
      models: ["llama-3.3-70b"],
      minStakeRequired: "50000000000000000000", // 50 EGLD
    });

    const adapter = new NodeRegistryAdapter({
      queryNodeFn: mockQueryNode,
    });

    const node = await adapter.getNodeInfo(15);
    expect(node?.isStaked).toBe(false);
  });
});
