import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { ClawRouterServer } from "../../src/router/router_server.js";
import { ArbitrageMatrix } from "../../src/router/arbitrage_matrix.js";
import { ModelMapper } from "../../src/router/model_mapper.js";
import { CascadingFallbackDispatcher } from "../../src/router/fallback_dispatcher.js";
import { ArbitragePricingEngine } from "../../src/router/arbitrage_pricing.js";
import { TwoPhaseReconciler } from "../../src/router/two_phase_reconciler.js";
import { SlaSlasher } from "../../src/router/sla_slasher.js";
import { MerchantPoolManager } from "../../src/services/merchant_pool.js";
import { IVerifierService } from "../../src/services/verifier.js";
import { VerifyResponse } from "../../src/domain/types.js";

class MockRouterVerifier implements IVerifierService {
  async verify(): Promise<VerifyResponse> {
    return {
      isValid: true,
      payer: "erd1client000000000000000000000000000000000000000000000000000000",
      network: "multiversx:1",
    };
  }
}

describe("ClawRouterServer (TDD)", () => {
  let matrix: ArbitrageMatrix;
  let mapper: ModelMapper;
  let dispatcher: CascadingFallbackDispatcher;
  let pricing: ArbitragePricingEngine;
  let reconciler: TwoPhaseReconciler;
  let slaSlasher: SlaSlasher;
  let merchantPool: MerchantPoolManager;
  let verifier: MockRouterVerifier;
  let routerServer: ClawRouterServer;
  let mockReportFailure: any;

  beforeEach(() => {
    matrix = new ArbitrageMatrix();
    matrix.registerProvider({
      id: "groq-fast",
      name: "Groq LPU",
      endpoint: "https://groq",
      costPerMillionInputTokensUsd: 0.5,
      costPerMillionOutputTokensUsd: 0.8,
      avgTtftMs: 95,
      tokensPerSecond: 280,
      healthy: true,
      supportedModels: ["deepseek-r1-distill-llama-70b", "llama-3.3-70b"],
    });

    mapper = new ModelMapper(matrix);
    dispatcher = new CascadingFallbackDispatcher({
      streamExecutor: async function* (p) {
        yield `Delta from ${p.id}`;
      },
    });
    pricing = new ArbitragePricingEngine();
    reconciler = new TwoPhaseReconciler();

    mockReportFailure = vi.fn().mockResolvedValue("mock-slash-1");
    slaSlasher = new SlaSlasher({ matrix });
    slaSlasher.reportFailure = mockReportFailure;

    merchantPool = new MerchantPoolManager();
    verifier = new MockRouterVerifier();

    routerServer = new ClawRouterServer({
      matrix,
      mapper,
      dispatcher,
      pricing,
      reconciler,
      slaSlasher,
      merchantPool,
      verifier,
    });
  });

  it("should return providers from GET /api/v1/claw/providers", async () => {
    const res = await request(routerServer.app).get("/api/v1/claw/providers");
    expect(res.status).toBe(200);
    expect(res.body.providers.length).toBe(1);
    expect(res.body.providers[0].id).toBe("groq-fast");
  });

  it("should issue HTTP 402 challenge on unpaid chat completion request", async () => {
    const res = await request(routerServer.app)
      .post("/api/v1/claw/chat/completions")
      .send({
        model: "auto:reasoning",
        messages: [{ role: "user", content: "Analyze market" }],
      });

    expect(res.status).toBe(402);
    expect(res.headers["payment-required"]).toBeDefined();
    expect(res.body.x402Version).toBe(2);
    expect(res.body.accepts[0].extra.arbitrageTier).toBe("auto:reasoning");
    expect(res.body.accepts[0].extra.projectedProvider).toBe("groq-fast");
  });

  it("should stream completion chunks with routing metadata on paid request", async () => {
    const dummySig = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        network: "multiversx:1",
        scheme: "exact",
        payload: { nonce: 1, signature: "sig" },
      })
    ).toString("base64");

    const res = await request(routerServer.app)
      .post("/api/v1/claw/chat/completions")
      .set("PAYMENT-SIGNATURE", dummySig)
      .set("x-payer-address", "erd1client000000000000000000000000000000000000000000000000000000")
      .send({
        model: "auto:reasoning",
        messages: [{ role: "user", content: "Analyze market" }],
        stream: true,
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.headers["x-claw-provider-selected"]).toBe("groq-fast");
    expect(res.headers["x-payment-receipt"]).toBeDefined();
    expect(res.text).toContain("Delta from groq-fast");
    expect(res.text).toContain("reconciliation");
  });

  it("should bypass 402 challenge when user has sufficient session credit in TwoPhaseReconciler", async () => {
    const clientAddr = "erd1client000000000000000000000000000000000000000000000000000000";
    // Pre-seed credit
    reconciler.reconcile({
      clientAddress: clientAddr,
      preAuthorizedMicroUsdc: 10000,
      actualMicroUsdc: 1000,
    });
    expect(reconciler.getCredit(clientAddr)).toBe(9000);

    // Make request without PAYMENT-SIGNATURE
    const res = await request(routerServer.app)
      .post("/api/v1/claw/chat/completions")
      .set("x-payer-address", clientAddr)
      .send({
        model: "auto:reasoning",
        messages: [{ role: "user", content: "Quick check" }],
        stream: true,
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.text).toContain("Delta from groq-fast");
  });

  it("should report failure to SlaSlasher when all providers fail", async () => {
    const brokenDispatcher = new CascadingFallbackDispatcher({
      streamExecutor: async function* () {
        throw new Error("Provider connection refused");
      },
    });

    const failingServer = new ClawRouterServer({
      matrix,
      mapper,
      dispatcher: brokenDispatcher,
      pricing,
      slaSlasher,
      verifier,
    });

    const dummySig = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        network: "multiversx:1",
        scheme: "exact",
        payload: { nonce: 1, signature: "sig" },
      })
    ).toString("base64");

    const res = await request(failingServer.app)
      .post("/api/v1/claw/chat/completions")
      .set("PAYMENT-SIGNATURE", dummySig)
      .send({
        model: "auto:reasoning",
        messages: [{ role: "user", content: "Analyze market" }],
      });

    expect(res.status).toBe(502);
    expect(mockReportFailure).toHaveBeenCalled();
  });
});
