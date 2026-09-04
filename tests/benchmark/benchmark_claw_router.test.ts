import { describe, it, expect } from "vitest";
import request from "supertest";
import { ClawRouterServer } from "../../src/router/router_server.js";
import { ArbitrageMatrix } from "../../src/router/arbitrage_matrix.js";
import { ModelMapper } from "../../src/router/model_mapper.js";
import { CascadingFallbackDispatcher } from "../../src/router/fallback_dispatcher.js";
import { ArbitragePricingEngine } from "../../src/router/arbitrage_pricing.js";
import { MerchantPoolManager } from "../../src/services/merchant_pool.js";
import { IVerifierService } from "../../src/services/verifier.js";
import { VerifyResponse } from "../../src/domain/types.js";

class FastClawVerifier implements IVerifierService {
  async verify(): Promise<VerifyResponse> {
    return {
      isValid: true,
      payer: "erd1client000000000000000000000000000000000000000000000000000000",
      network: "multiversx:1",
    };
  }
}

describe("ClawRouter High-Concurrency Chaos Benchmark", () => {
  it("should process 50 concurrent requests with zero client drops during upstream provider stalls", async () => {
    const matrix = new ArbitrageMatrix();
    // Primary provider (will stall occasionally)
    matrix.registerProvider({
      id: "groq-spot",
      name: "Groq Spot",
      endpoint: "https://groq",
      costPerMillionInputTokensUsd: 0.5,
      costPerMillionOutputTokensUsd: 0.8,
      avgTtftMs: 50,
      tokensPerSecond: 250,
      healthy: true,
      supportedModels: ["llama-3.3-70b"],
    });

    // Fallback provider (reliable)
    matrix.registerProvider({
      id: "together-spot",
      name: "Together Spot",
      endpoint: "https://together",
      costPerMillionInputTokensUsd: 0.6,
      costPerMillionOutputTokensUsd: 0.9,
      avgTtftMs: 80,
      tokensPerSecond: 150,
      healthy: true,
      supportedModels: ["llama-3.3-70b"],
    });

    let callCount = 0;
    const dispatcher = new CascadingFallbackDispatcher({
      fallbackTimeoutMs: 30, // 30ms TTFT threshold
      streamExecutor: async function* (provider) {
        callCount++;
        // Every 3rd call to primary stalls
        if (provider.id === "groq-spot" && callCount % 3 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 100)); // stall
          yield "Stalled chunk";
        } else {
          yield `Token chunk from ${provider.id}`;
        }
      },
    });

    const router = new ClawRouterServer({
      matrix,
      mapper: new ModelMapper(matrix),
      dispatcher,
      pricing: new ArbitragePricingEngine(),
      merchantPool: new MerchantPoolManager(),
      verifier: new FastClawVerifier(),
    });

    const server = router.app.listen(0);
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
          .post("/api/v1/claw/chat/completions")
          .set("PAYMENT-SIGNATURE", dummySig)
          .send({
            model: "llama-3.3-70b",
            messages: [{ role: "user", content: `Prompt ${i}` }],
            stream: true,
          })
      );

      const responses = await Promise.all(promises);
      const duration = Date.now() - start;

      expect(responses.length).toBe(totalRequests);
      for (const res of responses) {
        expect(res.status).toBe(200);
        expect(res.text).toContain("Token chunk from");
        expect(res.headers["x-payment-settled"]).toBe("true");
      }

      const reqsPerSec = (totalRequests / (duration / 1000)).toFixed(1);
      console.log(`ClawRouter Chaos Benchmark: ${totalRequests} streaming requests processed in ${duration}ms (${reqsPerSec} req/sec)`);
      expect(duration).toBeLessThan(10000);
    } finally {
      server.close();
    }
  });
});
