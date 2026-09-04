import { describe, it, expect, vi } from "vitest";
import { BlockRunMvxClient } from "../../src/client/blockrun_mvx_client.js";
import { ScraperClient } from "../../src/client/scraper_client.js";
import { SpendLimitError } from "../../src/client/errors.js";

describe("ScraperClient & fetchWithPayment (TDD)", () => {
  it("should autonomously handle 402 response in fetchWithPayment", async () => {
    let callCount = 0;
    const challengeBody = {
      x402Version: 2,
      accepts: [
        {
          scheme: "exact",
          network: "multiversx:1",
          amount: "1500",
          asset: "USDC-c76f1f",
          payTo: "erd1ka0yrspygvjtktyzxu58ufn0kujkqgx4gq2ch5ev2aqjcem9jcqqkntrmv",
          extra: { shard: 0, url: "/articles/sharding" },
        },
      ],
      error: "Payment Required",
      price: { amount: "0.001500", currency: "USD" },
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
            get: (h: string) => {
              if (h.toLowerCase() === "content-type") return "text/markdown";
              if (h.toLowerCase() === "x-payment-receipt") return "tx-receipt-scraper-123";
              return null;
            },
          },
          text: async () => "# Sharding\nContent here.",
        };
      }
    });

    const client = new BlockRunMvxClient({
      gatewayUrl: "http://localhost:8080",
      relayerAddress: "erd1ka0yrspygvjtktyzxu58ufn0kujkqgx4gq2ch5ev2aqjcem9jcqqkntrmv",
      fetch: mockFetch,
    });

    const res = await client.fetchWithPayment("http://localhost:8080/articles/sharding", {
      headers: { "user-agent": "ScraperBot/1.0" },
    });

    expect(res.status).toBe(200);
    expect(res.paymentReceipt).toBe("tx-receipt-scraper-123");
    const text = await res.text();
    expect(text).toContain("# Sharding");
    expect(callCount).toBe(2);
  });

  it("should enforce maxSessionCost in fetchWithPayment", async () => {
    const challengeBody = {
      x402Version: 2,
      accepts: [
        {
          scheme: "exact",
          network: "multiversx:1",
          amount: "50000", // $0.05
          asset: "USDC-c76f1f",
          payTo: "erd1ka0yrspygvjtktyzxu58ufn0kujkqgx4gq2ch5ev2aqjcem9jcqqkntrmv",
          extra: { shard: 0 },
        },
      ],
      error: "Payment Required",
      price: { amount: "0.050000", currency: "USD" },
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
      gatewayUrl: "http://localhost:8080",
      fetch: mockFetch,
      maxSessionCost: 0.02, // limit is $0.02, but call is $0.05
    });

    await expect(
      client.fetchWithPayment("http://localhost:8080/articles/expensive")
    ).rejects.toThrow(SpendLimitError);
  });

  it("should scrape multiple URLs in batch using ScraperClient", async () => {
    const mockMvxClient = {
      fetchWithPayment: vi.fn().mockImplementation(async (url: string) => {
        return {
          status: 200,
          ok: true,
          headers: {
            get: (h: string) => (h === "x-payment-receipt" ? "mock-receipt-hash" : null),
          },
          text: async () => `# Markdown for ${url}`,
          paymentReceipt: "mock-receipt-hash",
        };
      }),
    };

    const scraper = new ScraperClient({
      client: mockMvxClient as any,
      concurrency: 3,
    });

    const urls = [
      "https://site.com/p1",
      "https://site.com/p2",
      "https://site.com/p3",
      "https://site.com/p4",
    ];

    const results = await scraper.scrapeBatch(urls);
    expect(results.length).toBe(4);
    for (const res of results) {
      expect(res.success).toBe(true);
      expect(res.markdown).toContain("Markdown for https://site.com");
      expect(res.paymentReceipt).toBe("mock-receipt-hash");
    }
  });
});
