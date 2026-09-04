import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { TollboothServer } from "../../src/tollbooth/tollbooth_server.js";
import { BotClassifier } from "../../src/tollbooth/bot_classifier.js";
import { MarkdownExtractor } from "../../src/tollbooth/markdown_extractor.js";
import { TollPricingEngine } from "../../src/tollbooth/toll_pricing_engine.js";
import { TollboothReputationAdapter } from "../../src/tollbooth/reputation_adapter.js";
import { AbuseReporter } from "../../src/tollbooth/abuse_reporter.js";
import { IVerifierService } from "../../src/services/verifier.js";
import { VerifyResponse, PaymentErrorCode } from "../../src/domain/types.js";

class MockVerifier implements IVerifierService {
  public shouldSucceed = true;
  async verify(): Promise<VerifyResponse> {
    if (this.shouldSucceed) {
      return {
        isValid: true,
        payer: "erd1client000000000000000000000000000000000000000000000000000000",
        network: "multiversx:1",
      };
    }
    return {
      isValid: false,
      errorCode: PaymentErrorCode.INVALID_SIGNATURE,
      errorMessage: "Invalid signature",
    };
  }
}

describe("TollboothServer (TDD)", () => {
  const originHtml = `
    <html>
      <head><title>Test Article</title></head>
      <body>
        <header><h1>Autonomous Scraper Tollbooth</h1></header>
        <p>This is premium documentation for MultiversX.</p>
        <aside>Ad</aside>
      </body>
    </html>
  `;

  let mockOriginFetch: any;
  let classifier: BotClassifier;
  let extractor: MarkdownExtractor;
  let pricingEngine: TollPricingEngine;
  let reputationAdapter: TollboothReputationAdapter;
  let abuseReporter: AbuseReporter;
  let verifier: MockVerifier;
  let tollbooth: TollboothServer;
  let mockRecordFailure: any;

  beforeEach(() => {
    mockOriginFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      text: async () => originHtml,
    });

    classifier = new BotClassifier();
    extractor = new MarkdownExtractor();
    pricingEngine = new TollPricingEngine();
    verifier = new MockVerifier();

    reputationAdapter = new TollboothReputationAdapter({
      reputationClient: {
        getReputationScore: async (nonce) => (nonce === 42 ? 95 : 40),
      } as any,
    });

    abuseReporter = new AbuseReporter();
    mockRecordFailure = vi.fn().mockResolvedValue(undefined);
    abuseReporter.recordFailure = mockRecordFailure;

    tollbooth = new TollboothServer({
      classifier,
      extractor,
      pricingEngine,
      reputationAdapter,
      abuseReporter,
      verifier,
      originFetch: mockOriginFetch,
      network: "multiversx:1",
    });
  });

  it("should pass human requests through to origin without 402 challenge", async () => {
    const humanUa =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

    const res = await request(tollbooth.app)
      .get("/docs/article-1")
      .set("user-agent", humanUa)
      .set("cookie", "session=123")
      .set("sec-ch-ua", '"Chrome"');

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("Test Article");
  });

  it("should intercept bot requests without payment and issue HTTP 402 challenge", async () => {
    const res = await request(tollbooth.app)
      .get("/docs/article-1")
      .set("user-agent", "GPTBot/1.2")
      .set("accept", "text/markdown");

    expect(res.status).toBe(402);
    expect(res.headers["payment-required"]).toBeDefined();
    expect(res.headers["www-authenticate"]).toContain("x402");
    expect(res.headers["x-tollbooth-tier"]).toBe("probe");
    expect(res.body.x402Version).toBe(2);
    expect(res.body.accepts[0].asset).toBe("USDC-c76f1f");
  });

  it("should apply VIP tier discount when valid X-Agent-Identity is provided", async () => {
    const res = await request(tollbooth.app)
      .get("/docs/article-1")
      .set("user-agent", "GPTBot/1.2")
      .set("accept", "text/markdown")
      .set("x-agent-identity", "42");

    expect(res.status).toBe(402);
    expect(res.headers["x-tollbooth-tier"]).toBe("vip");
    // VIP cost should be much lower than probe tier cost
    const amount = parseInt(res.body.accepts[0].amount, 10);
    expect(amount).toBeLessThan(2000);
  });

  it("should verify paid bot request and return clean token-dense Markdown", async () => {
    const dummySig = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        network: "multiversx:1",
        scheme: "exact",
        payload: { nonce: 1, signature: "valid" },
      })
    ).toString("base64");

    const res = await request(tollbooth.app)
      .get("/docs/article-1")
      .set("user-agent", "GPTBot/1.2")
      .set("accept", "text/markdown")
      .set("PAYMENT-SIGNATURE", dummySig);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/markdown");
    expect(res.headers["x-payment-receipt"]).toBeDefined();
    expect(res.headers["x-payment-settled"]).toBe("true");
    expect(res.headers["x-tollbooth-tokens"]).toBeDefined();
    expect(res.text).toContain("# Autonomous Scraper Tollbooth");
    expect(res.text).toContain("This is premium documentation for MultiversX.");
    expect(res.text).not.toContain("<aside>");
  });

  it("should record failure in AbuseReporter when payment signature is invalid", async () => {
    verifier.shouldSucceed = false;

    const res = await request(tollbooth.app)
      .get("/docs/article-1")
      .set("user-agent", "GPTBot/1.2")
      .set("accept", "text/markdown")
      .set("x-agent-identity", "99")
      .set("PAYMENT-SIGNATURE", "invalid-sig");

    expect(res.status).toBe(402);
    expect(res.body.error).toContain("Payment verification failed");
    expect(mockRecordFailure).toHaveBeenCalledWith(expect.any(String), 99);
  });

  it("should serve dynamic /robots.txt advertising x402 payment scheme", async () => {
    const res = await request(tollbooth.app).get("/robots.txt");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.text).toContain("X402-Payment-Required: true");
    expect(res.text).toContain("X402-Network: multiversx:1");
    expect(res.text).toContain("X402-Rate: 1500 micro-USDC");
  });

  it("should serve dynamic /ai.txt adhering to AI crawler permission standard", async () => {
    const res = await request(tollbooth.app).get("/ai.txt");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.text).toContain("User-agent: GPTBot");
    expect(res.text).toContain("Permission: allowed-with-payment");
    expect(res.text).toContain("Payment-Protocol: x402-v2");
    expect(res.text).toContain("Payment-Rate: 1500 micro-USDC");
  });

  it("should reject spoofed bot crawlers with 403 Forbidden", async () => {
    // A non-OpenAI public IP claims to be GPTBot
    const res = await request(tollbooth.app)
      .get("/docs/article-1")
      .set("user-agent", "GPTBot/1.2")
      .set("x-forwarded-for", "185.220.101.5"); // Tor exit node / spoofed IP

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Spoofed bot identity detected");
    expect(res.body.verificationStatus).toBe("spoofed");
  });

  it("should serve interactive API documentation at /docs and /openapi.json", async () => {
    const docsRes = await request(tollbooth.app).get("/docs");
    expect(docsRes.status).toBe(200);
    expect(docsRes.text).toContain("SwaggerUIBundle");

    const openapiRes = await request(tollbooth.app).get("/openapi.json");
    expect(openapiRes.status).toBe(200);
    expect(openapiRes.body.openapi).toBe("3.0.3");
  });

  it("should serve monetization telemetry on both /stats and /analytics", async () => {
    const statsRes = await request(tollbooth.app).get("/stats");
    expect(statsRes.status).toBe(200);
    expect(statsRes.body.totalRequests).toBeDefined();

    const analyticsRes = await request(tollbooth.app).get("/analytics");
    expect(analyticsRes.status).toBe(200);
    expect(analyticsRes.body.revenueMicroUsdc).toBe(statsRes.body.revenueMicroUsdc);
  });
});
