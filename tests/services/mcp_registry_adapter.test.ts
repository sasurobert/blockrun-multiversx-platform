import { describe, it, expect, vi } from "vitest";
import { McpRegistryAdapter } from "../../src/services/mcp_registry_adapter.js";

describe("McpRegistryAdapter (TDD)", () => {
  it("should query agent service pricing and cache result", async () => {
    const mockQueryFn = vi.fn().mockResolvedValue({
      token: "USDC-c76f1f",
      amount: "5000",
      nonce: 0,
    });

    const adapter = new McpRegistryAdapter({
      identityContractAddress: "erd1qqqqqqqqqqqqqpgqak8zt22wl2ph4622up82t098pknqq6cvjcqq8p5w8s",
      queryServiceConfigFn: mockQueryFn,
      cacheTtlMs: 5000,
    });

    const config1 = await adapter.getServiceConfig(42, 101);
    expect(config1).toEqual({
      token: "USDC-c76f1f",
      amount: "5000",
      nonce: 0,
    });
    expect(mockQueryFn).toHaveBeenCalledTimes(1);

    // Second call should hit in-memory cache
    const config2 = await adapter.getServiceConfig(42, 101);
    expect(config2).toEqual(config1);
    expect(mockQueryFn).toHaveBeenCalledTimes(1);
  });

  it("should return null if agent service is not found", async () => {
    const mockQueryFn = vi.fn().mockResolvedValue(null);

    const adapter = new McpRegistryAdapter({
      identityContractAddress: "erd1qqqqqqqqqqqqqpgqak8zt22wl2ph4622up82t098pknqq6cvjcqq8p5w8s",
      queryServiceConfigFn: mockQueryFn,
    });

    const config = await adapter.getServiceConfig(999, 999);
    expect(config).toBeNull();
  });

  it("should allow registering static in-memory tool definitions for development and local testing", async () => {
    const adapter = new McpRegistryAdapter({});
    adapter.registerLocalTool({
      name: "multiversx-analyzer",
      description: "Smart contract analyzer",
      inputSchema: { type: "object" },
      pricing: {
        microUsdc: "5000",
        usdFormatted: "$0.005000",
        token: "USDC-c76f1f",
        serviceId: 101,
        providerAgentNonce: 42,
      },
    });

    const tool = adapter.getLocalTool("multiversx-analyzer");
    expect(tool).toBeDefined();
    expect(tool?.pricing.microUsdc).toBe("5000");

    const allTools = adapter.listLocalTools();
    expect(allTools.length).toBe(1);
  });
});
