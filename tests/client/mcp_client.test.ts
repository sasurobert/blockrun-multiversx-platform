import { describe, it, expect, vi } from "vitest";
import { BlockRunMvxClient } from "../../src/client/blockrun_mvx_client.js";
import { SpendLimitError } from "../../src/client/errors.js";

describe("BlockRunMvxClient MCP Integration (TDD)", () => {
  it("should list available MCP tools from gateway", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        tools: [
          {
            name: "multiversx-analyzer",
            description: "Deep analyzer",
            inputSchema: { type: "object" },
            pricing: {
              microUsdc: "5000",
              usdFormatted: "$0.005000",
              token: "USDC-c76f1f",
              serviceId: 101,
              providerAgentNonce: 42,
            },
          },
        ],
      }),
    });

    const client = new BlockRunMvxClient({
      gatewayUrl: "http://localhost:3500",
      fetch: mockFetch,
    });

    const tools = await client.listMcpTools();
    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe("multiversx-analyzer");
  });

  it("should call MCP tool with 402 payment challenge and return execution result", async () => {
    let callCount = 0;
    const challengeBody = {
      x402Version: 2,
      accepts: [
        {
          scheme: "exact",
          network: "multiversx:1",
          amount: "5000",
          asset: "USDC-c76f1f",
          payTo: "erd1ka0yrspygvjtktyzxu58ufn0kujkqgx4gq2ch5ev2aqjcem9jcqqkntrmv",
          extra: { shard: 0, serviceId: 101, tool: "multiversx-analyzer" },
        },
      ],
      error: "Payment Required",
      price: { amount: "0.005000", currency: "USD" },
    };
    const challengeBase64 = Buffer.from(JSON.stringify(challengeBody)).toString("base64");

    const mockFetch = vi.fn().mockImplementation(async (_url, _opts) => {
      callCount++;
      if (callCount === 1) {
        // Return 402 challenge
        return {
          status: 402,
          ok: false,
          headers: {
            get: (h: string) => {
              if (h.toLowerCase() === "payment-required") return challengeBase64;
              return null;
            },
          },
          json: async () => challengeBody,
        };
      } else {
        // Return 200 OK
        return {
          status: 200,
          ok: true,
          headers: {
            get: (h: string) => {
              if (h.toLowerCase() === "x-payment-receipt") return "mock-tx-receipt-hash-123";
              return null;
            },
          },
          json: async () => ({
            jsonrpc: "2.0",
            id: "req-1",
            result: {
              content: [{ type: "text", text: "Security Analysis: Contract is safe." }],
              isError: false,
            },
            paymentReceipt: "mock-tx-receipt-hash-123",
          }),
        };
      }
    });

    const client = new BlockRunMvxClient({
      gatewayUrl: "http://localhost:3500",
      relayerAddress: "erd1ka0yrspygvjtktyzxu58ufn0kujkqgx4gq2ch5ev2aqjcem9jcqqkntrmv",
      fetch: mockFetch,
    });

    const res = await client.callMcpTool("multiversx-analyzer", { address: "erd1test" });
    expect(res.result.content[0].text).toContain("Contract is safe");
    expect(res.paymentReceipt).toBe("mock-tx-receipt-hash-123");
    expect(callCount).toBe(2);
  });

  it("should read MCP resource with 402 payment challenge and return content", async () => {
    let callCount = 0;
    const challengeBody = {
      x402Version: 2,
      accepts: [
        {
          scheme: "exact",
          network: "multiversx:1",
          amount: "1000",
          asset: "USDC-c76f1f",
          payTo: "erd1ka0yrspygvjtktyzxu58ufn0kujkqgx4gq2ch5ev2aqjcem9jcqqkntrmv",
          extra: { shard: 0, uri: "multiversx://schema/esdt" },
        },
      ],
      error: "Payment Required",
      price: { amount: "0.001000", currency: "USD" },
    };
    const challengeBase64 = Buffer.from(JSON.stringify(challengeBody)).toString("base64");

    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          status: 402,
          ok: false,
          headers: {
            get: (h: string) => (h.toLowerCase() === "payment-required" ? challengeBase64 : null),
          },
          json: async () => challengeBody,
        };
      } else {
        return {
          status: 200,
          ok: true,
          headers: {
            get: (h: string) => (h.toLowerCase() === "x-payment-receipt" ? "mock-receipt-res" : null),
          },
          json: async () => ({
            jsonrpc: "2.0",
            id: "req-res-1",
            result: {
              contents: [{ uri: "multiversx://schema/esdt", text: "Schema content" }],
            },
            paymentReceipt: "mock-receipt-res",
          }),
        };
      }
    });

    const client = new BlockRunMvxClient({
      gatewayUrl: "http://localhost:3500",
      relayerAddress: "erd1ka0yrspygvjtktyzxu58ufn0kujkqgx4gq2ch5ev2aqjcem9jcqqkntrmv",
      fetch: mockFetch,
    });

    const res = await client.readMcpResource("multiversx://schema/esdt");
    expect(res.result.contents[0].text).toBe("Schema content");
    expect(res.paymentReceipt).toBe("mock-receipt-res");
    expect(callCount).toBe(2);
  });

  it("should rate tool execution via reputation feedback endpoint", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ txHash: "feedback-tx-confirmed-99" }),
    });

    const client = new BlockRunMvxClient({
      gatewayUrl: "http://localhost:3500",
      fetch: mockFetch,
    });

    const feedback = await client.rateToolExecution("job-mcp-99", 42, 98);
    expect(feedback.txHash).toBe("feedback-tx-confirmed-99");
  });

  it("should deposit and release escrow for high-value tool execution", async () => {
    const client = new BlockRunMvxClient({
      gatewayUrl: "http://localhost:3500",
    });

    const deposit = await client.depositEscrow({
      jobId: "high-value-job-1",
      receiver: "erd1ka0yrspygvjtktyzxu58ufn0kujkqgx4gq2ch5ev2aqjcem9jcqqkntrmv",
      amount: "500000", // $0.50
    });
    expect(deposit.jobId).toBe("high-value-job-1");
    expect(deposit.txHash).toBeDefined();

    const release = await client.releaseEscrow("high-value-job-1");
    expect(release.status).toBe("released");
    expect(release.txHash).toBeDefined();
  });

  it("should throw SpendLimitError if tool call price exceeds maxCostPerCall", async () => {
    const challengeBody = {
      x402Version: 2,
      accepts: [
        {
          scheme: "exact",
          network: "multiversx:1",
          amount: "100000", // $0.10
          asset: "USDC-c76f1f",
          payTo: "erd1ka0yrspygvjtktyzxu58ufn0kujkqgx4gq2ch5ev2aqjcem9jcqqkntrmv",
          extra: { shard: 0, serviceId: 101 },
        },
      ],
      error: "Payment Required",
      price: { amount: "0.100000", currency: "USD" },
    };
    const challengeBase64 = Buffer.from(JSON.stringify(challengeBody)).toString("base64");

    const mockFetch = vi.fn().mockResolvedValue({
      status: 402,
      ok: false,
      headers: {
        get: (h: string) => (h.toLowerCase() === "payment-required" ? challengeBase64 : null),
      },
      json: async () => challengeBody,
    });

    const client = new BlockRunMvxClient({
      gatewayUrl: "http://localhost:3500",
      fetch: mockFetch,
      maxCostPerCall: 0.05, // limit is $0.05
    });

    await expect(
      client.callMcpTool("expensive-tool", {})
    ).rejects.toThrow(SpendLimitError);
  });
});
