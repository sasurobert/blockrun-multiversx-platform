import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpRegistryAdapter } from "../../src/services/mcp_registry_adapter.js";
import fs from "fs";
import path from "path";
import os from "os";

describe("McpRegistryAdapter (TDD)", () => {
  let tmpDbDir: string;
  let tmpDbPath: string;

  beforeEach(() => {
    tmpDbDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-registry-test-"));
    tmpDbPath = path.join(tmpDbDir, "test_tools.db");
  });

  afterEach(() => {
    if (fs.existsSync(tmpDbDir)) {
      fs.rmSync(tmpDbDir, { recursive: true, force: true });
    }
  });

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
      dbPathOrDb: ":memory:",
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
    adapter.close();
  });

  it("should return null if agent service is not found", async () => {
    const mockQueryFn = vi.fn().mockResolvedValue(null);

    const adapter = new McpRegistryAdapter({
      identityContractAddress: "erd1qqqqqqqqqqqqqpgqak8zt22wl2ph4622up82t098pknqq6cvjcqq8p5w8s",
      queryServiceConfigFn: mockQueryFn,
      dbPathOrDb: ":memory:",
    });

    const config = await adapter.getServiceConfig(999, 999);
    expect(config).toBeNull();
    adapter.close();
  });

  it("should allow registering static tool definitions in SQLite storage", async () => {
    const adapter = new McpRegistryAdapter({ dbPathOrDb: ":memory:" });
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
      payTo: "erd1qqqqqqqqqqqqqpgqhe8t5jewej70zupmh44eurgn29psua5l2jps3ntjj3",
      endpointUrl: "https://analyzer.blockrun.io/mcp",
    });

    const tool = adapter.getLocalTool("multiversx-analyzer");
    expect(tool).toBeDefined();
    expect(tool?.pricing.microUsdc).toBe("5000");
    expect(tool?.payTo).toBe("erd1qqqqqqqqqqqqqpgqhe8t5jewej70zupmh44eurgn29psua5l2jps3ntjj3");
    expect(tool?.endpointUrl).toBe("https://analyzer.blockrun.io/mcp");

    const allTools = adapter.listLocalTools();
    expect(allTools.length).toBe(1);
    adapter.close();
  });

  it("should verify tools survive server restarts via persistent SQLite storage", async () => {
    // 1. First instance registers tools
    const adapter1 = new McpRegistryAdapter({ dbPathOrDb: tmpDbPath });
    adapter1.registerLocalTool({
      name: "multiversx_account_inspector",
      description: "Queries on-chain account data",
      inputSchema: {
        type: "object",
        properties: { address: { type: "string" } },
        required: ["address"],
      },
      pricing: {
        microUsdc: "10000",
        usdFormatted: "$0.010000",
        token: "USDC-350c4e",
        serviceId: 1,
        providerAgentNonce: 1,
      },
      payTo: "erd1spyavw0956vq68xj8ymmxtxws2ah0mgr2ww05nv2gl35dp9xnseq6lvd30",
      endpointUrl: "https://tools.blockrun.io/inspector",
    });

    adapter1.registerLocalTool({
      name: "multiversx_tx_builder",
      description: "Builds Relayed V3 transactions",
      inputSchema: { type: "object" },
      pricing: {
        microUsdc: "25000",
        usdFormatted: "$0.025000",
        token: "USDC-350c4e",
        serviceId: 2,
        providerAgentNonce: 1,
      },
    });

    // Record execution health on first instance
    adapter1.recordToolExecution("multiversx_account_inspector", true, 45);
    adapter1.recordToolExecution("multiversx_account_inspector", true, 35);
    const healthBefore = adapter1.getToolHealth("multiversx_account_inspector");
    expect(healthBefore?.callCount).toBe(2);
    expect(healthBefore?.errorCount).toBe(0);
    expect(healthBefore?.status).toBe("healthy");

    // Close first instance (simulating server shutdown)
    adapter1.close();

    // 2. Second instance opens the exact same SQLite database (simulating restart)
    const adapter2 = new McpRegistryAdapter({ dbPathOrDb: tmpDbPath });

    const toolsAfterRestart = adapter2.listLocalTools();
    expect(toolsAfterRestart.length).toBe(2);

    const tool1 = adapter2.getLocalTool("multiversx_account_inspector");
    expect(tool1).toBeDefined();
    expect(tool1?.name).toBe("multiversx_account_inspector");
    expect(tool1?.description).toBe("Queries on-chain account data");
    expect(tool1?.pricing.microUsdc).toBe("10000");
    expect(tool1?.payTo).toBe("erd1spyavw0956vq68xj8ymmxtxws2ah0mgr2ww05nv2gl35dp9xnseq6lvd30");
    expect(tool1?.endpointUrl).toBe("https://tools.blockrun.io/inspector");

    const tool2 = adapter2.getLocalTool("multiversx_tx_builder");
    expect(tool2).toBeDefined();
    expect(tool2?.pricing.microUsdc).toBe("25000");

    // Verify health persisted across restart
    const healthAfter = adapter2.getToolHealth("multiversx_account_inspector");
    expect(healthAfter).toBeDefined();
    expect(healthAfter?.callCount).toBe(2);
    expect(healthAfter?.errorCount).toBe(0);
    expect(healthAfter?.status).toBe("healthy");

    // Continue executing on second instance
    adapter2.recordToolExecution("multiversx_account_inspector", false, 120);
    const updatedHealth = adapter2.getToolHealth("multiversx_account_inspector");
    expect(updatedHealth?.callCount).toBe(3);
    expect(updatedHealth?.errorCount).toBe(1);

    adapter2.close();
  });

  it("should properly update tool health status across failures and heartbeats", async () => {
    const adapter = new McpRegistryAdapter({ dbPathOrDb: ":memory:" });
    adapter.registerLocalTool({
      name: "flaky_tool",
      description: "Flaky test tool",
      inputSchema: {},
      pricing: {
        microUsdc: "1000",
        usdFormatted: "$0.001",
        token: "USDC-350c4e",
        serviceId: 10,
        providerAgentNonce: 1,
      },
    });

    const initial = adapter.getToolHealth("flaky_tool");
    expect(initial?.status).toBe("healthy");

    // 1 failure out of 1 call -> errorRate 1.0 > 0.5 -> unreachable
    adapter.recordToolExecution("flaky_tool", false, 100);
    let health = adapter.getToolHealth("flaky_tool");
    expect(health?.status).toBe("unreachable");
    expect(health?.errorCount).toBe(1);

    // Heartbeat updates latency and status
    adapter.recordToolHeartbeat("flaky_tool", 25, "healthy");
    health = adapter.getToolHealth("flaky_tool");
    expect(health?.latencyMs).toBe(25);
    expect(health?.status).toBe("healthy");

    adapter.close();
  });

  it("should restore external tool HTTP handlers across server process restart via McpGateway", async () => {
    const { McpGateway } = await import("../../src/gateway/mcp_gateway.js");
    const { McpExecutor } = await import("../../src/services/mcp_executor.js");
    const { MerchantPoolManager } = await import("../../src/services/merchant_pool.js");

    // 1. First server session registers an external tool in SQLite
    const adapter1 = new McpRegistryAdapter({ dbPathOrDb: tmpDbPath });
    adapter1.registerLocalTool({
      name: "persisted_weather_tool",
      description: "Live weather tool with external HTTP endpoint",
      inputSchema: { type: "object" },
      pricing: {
        microUsdc: "15000",
        usdFormatted: "$0.015",
        token: "USDC-350c4e",
        serviceId: 88,
        providerAgentNonce: 1,
      },
      endpointUrl: "https://weather.example.com/api/mcp",
    });
    adapter1.close();

    // 2. Second server session starts with the exact same DB file
    const adapter2 = new McpRegistryAdapter({ dbPathOrDb: tmpDbPath });
    const executor2 = new McpExecutor();

    expect(executor2.hasHandler("persisted_weather_tool")).toBe(false);

    // Initializing gateway boots external handlers from durable registry
    new McpGateway({
      registry: adapter2,
      executor: executor2,
      merchantPool: new MerchantPoolManager(),
      verifier: { verify: vi.fn() } as any,
      network: "multiversx:D",
    });

    // Verify handler was dynamically restored and bound
    expect(executor2.hasHandler("persisted_weather_tool")).toBe(true);

    adapter2.close();
  });
});
