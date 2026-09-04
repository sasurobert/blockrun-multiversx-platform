import { describe, it, expect } from "vitest";
import request from "supertest";
import { McpGateway } from "../../src/gateway/mcp_gateway.js";
import { McpRegistryAdapter } from "../../src/services/mcp_registry_adapter.js";
import { McpExecutor } from "../../src/services/mcp_executor.js";
import { MerchantPoolManager } from "../../src/services/merchant_pool.js";
import { IVerifierService } from "../../src/services/verifier.js";
import { VerifyResponse } from "../../src/domain/types.js";

class FastVerifier implements IVerifierService {
  async verify(): Promise<VerifyResponse> {
    return {
      isValid: true,
      payer: "erd1client000000000000000000000000000000000000000000000000000000",
      network: "multiversx:1",
    };
  }
}

describe("MCP Gateway Concurrency & Performance Benchmark", () => {
  it("should process concurrent tool calls with sub-second latency", async () => {
    const registry = new McpRegistryAdapter();
    registry.registerLocalTool({
      name: "bench-tool",
      description: "Fast benchmark tool",
      inputSchema: {},
      pricing: {
        microUsdc: "1000",
        usdFormatted: "$0.001000",
        token: "USDC-c76f1f",
        serviceId: 1,
        providerAgentNonce: 1,
      },
    });

    const executor = new McpExecutor();
    executor.registerHandler("bench-tool", async () => ({
      content: [{ type: "text", text: "ok" }],
      isError: false,
    }));

    const gateway = new McpGateway({
      registry,
      executor,
      merchantPool: new MerchantPoolManager(),
      verifier: new FastVerifier(),
    });

    const server = gateway.app.listen(0);
    const port = (server.address() as any).port;

    const dummySig = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        network: "multiversx:1",
        scheme: "exact",
        payload: { nonce: 1, signature: "sig" },
      })
    ).toString("base64");

    const totalRequests = 50;
    const start = Date.now();

    try {
      const promises = Array.from({ length: totalRequests }).map((_, i) =>
        request(`http://127.0.0.1:${port}`)
          .post("/mcp/v1/tools/call")
          .set("PAYMENT-SIGNATURE", dummySig)
          .send({
            jsonrpc: "2.0",
            id: `bench-${i}`,
            method: "tools/call",
            params: { name: "bench-tool", arguments: {} },
          })
      );

      const responses = await Promise.all(promises);
      const duration = Date.now() - start;

      expect(responses.length).toBe(totalRequests);
      for (const res of responses) {
        expect(res.status).toBe(200);
        expect(res.body.result.isError).toBe(false);
        expect(res.headers["x-payment-settled"]).toBe("true");
      }

      const reqsPerSec = (totalRequests / (duration / 1000)).toFixed(1);
      console.log(`MCP Gateway Benchmark: ${totalRequests} requests completed in ${duration}ms (${reqsPerSec} req/sec)`);
      expect(duration).toBeLessThan(10000);
    } finally {
      server.close();
    }
  });
});
