import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { TollboothServer } from "../../src/tollbooth/tollbooth_server.js";
import { BotClassifier } from "../../src/tollbooth/bot_classifier.js";
import { MarkdownExtractor } from "../../src/tollbooth/markdown_extractor.js";
import { TollPricingEngine } from "../../src/tollbooth/toll_pricing_engine.js";
import { IVerifierService } from "../../src/services/verifier.js";
import { VerifyResponse } from "../../src/domain/types.js";

class FastTollVerifier implements IVerifierService {
  async verify(): Promise<VerifyResponse> {
    return {
      isValid: true,
      payer: "erd1client000000000000000000000000000000000000000000000000000000",
      network: "multiversx:1",
    };
  }
}

describe("Tollbooth Stress Test & Throughput Benchmark", () => {
  it("should handle 50 concurrent scraper requests with full HTML-to-Markdown transformation", async () => {
    const rawHtml = `
      <html>
        <head><title>Batch Scrape Page</title></head>
        <body>
          <nav>Nav</nav>
          <h1>Article Content</h1>
          <p>Paragraph explaining MultiversX Sirius fast finality.</p>
          <footer>Footer</footer>
        </body>
      </html>
    `;

    const mockOriginFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      text: async () => rawHtml,
    });

    const tollbooth = new TollboothServer({
      classifier: new BotClassifier(),
      extractor: new MarkdownExtractor(),
      pricingEngine: new TollPricingEngine(),
      verifier: new FastTollVerifier(),
      originFetch: mockOriginFetch,
    });

    const server = tollbooth.app.listen(0);
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
          .get(`/articles/page-${i}`)
          .set("user-agent", "GPTBot/1.2")
          .set("accept", "text/markdown")
          .set("PAYMENT-SIGNATURE", dummySig)
      );

      const responses = await Promise.all(promises);
      const duration = Date.now() - start;

      expect(responses.length).toBe(totalRequests);
      for (const res of responses) {
        expect(res.status).toBe(200);
        expect(res.text).toContain("# Article Content");
        expect(res.headers["content-type"]).toContain("text/markdown");
        expect(res.headers["x-payment-settled"]).toBe("true");
      }

      const pagesPerSec = (totalRequests / (duration / 1000)).toFixed(1);
      console.log(`Tollbooth Stress Test: ${totalRequests} pages converted in ${duration}ms (${pagesPerSec} pages/sec)`);
      expect(duration).toBeLessThan(10000);
    } finally {
      server.close();
    }
  });
});
