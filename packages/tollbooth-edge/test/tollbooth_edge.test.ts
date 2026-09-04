import { describe, it, expect, vi } from "vitest";
import {
  createTollboothEdgeHandler,
  tollboothMiddleware,
  BOT_USER_AGENTS,
} from "../src/index.js";

describe("@sasurobert/tollbooth-edge", () => {
  const merchantAddress =
    "erd123g08w7g2p9qxynfhplxukearq68uyqn2fvepyyf33pd40ea95as02yv3k";

  it("should match known bot user agents", () => {
    expect(BOT_USER_AGENTS.some((r) => r.test("GPTBot/1.0"))).toBe(true);
    expect(BOT_USER_AGENTS.some((r) => r.test("ClaudeBot/1.0"))).toBe(true);
    expect(BOT_USER_AGENTS.some((r) => r.test("PerplexityBot/1.0"))).toBe(true);
    expect(
      BOT_USER_AGENTS.some((r) =>
        r.test("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
      )
    ).toBe(false);
  });

  it("should pass human requests through to origin in edge handler", async () => {
    const handler = createTollboothEdgeHandler({
      merchantAddress,
      network: "multiversx:D",
      tokenId: "USDC-350c4e",
    });

    // Mock global fetch
    const mockOriginResponse = new Response("<h1>Human Webpage</h1>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockOriginResponse));

    const req = new Request("https://example.com/docs", {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        accept: "text/html",
      },
    });

    const res = await handler(req);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Human Webpage");
  });

  it("should intercept AI crawler and issue HTTP 402 challenge with MultiversX Devnet requirements", async () => {
    const handler = createTollboothEdgeHandler({
      merchantAddress,
      network: "multiversx:D",
      tokenId: "USDC-350c4e",
      rateMicroUsdc: "2500",
    });

    const req = new Request("https://example.com/docs", {
      headers: {
        "user-agent": "GPTBot/1.2 (+https://openai.com/gptbot)",
        accept: "text/markdown",
      },
    });

    const res = await handler(req);
    expect(res.status).toBe(402);
    expect(res.headers.get("payment-required")).toBeDefined();
    expect(res.headers.get("www-authenticate")).toContain("x402");
    expect(res.headers.get("www-authenticate")).toContain("multiversx:D");
    expect(res.headers.get("www-authenticate")).toContain("USDC-350c4e");

    const json = await res.json();
    expect(json.x402Version).toBe(2);
    expect(json.accepts[0].amount).toBe("2500");
    expect(json.accepts[0].asset).toBe("USDC-350c4e");
    expect(json.accepts[0].payTo).toBe(merchantAddress);
  });

  it("should pass paid bot requests through with payment signature", async () => {
    const handler = createTollboothEdgeHandler({
      merchantAddress,
      network: "multiversx:D",
      tokenId: "USDC-350c4e",
    });

    const mockOriginResponse = new Response("# Markdown Documentation", {
      status: 200,
      headers: { "content-type": "text/markdown" },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockOriginResponse));

    const req = new Request("https://example.com/docs", {
      headers: {
        "user-agent": "ClaudeBot/1.0",
        accept: "text/markdown",
        "payment-signature": "base64-signed-payload-here",
      },
    });

    const res = await handler(req);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("# Markdown Documentation");
  });

  it("should work as Express / Node middleware", async () => {
    const middleware = tollboothMiddleware({
      merchantAddress,
      network: "multiversx:D",
      tokenId: "USDC-350c4e",
    });

    // Case 1: Human request -> calls next()
    const next1 = vi.fn();
    const req1: any = {
      headers: { "user-agent": "Mozilla/5.0 Safari/537.36", accept: "text/html" },
      url: "/page",
    };
    const res1: any = {};
    await middleware(req1, res1, next1);
    expect(next1).toHaveBeenCalledTimes(1);

    // Case 2: Bot request without payment -> sends 402
    const next2 = vi.fn();
    const req2: any = {
      headers: { "user-agent": "GPTBot/1.2", accept: "text/markdown" },
      url: "/page",
    };
    let statusCode = 0;
    let jsonBody: any = null;
    const headersSet: Record<string, string> = {};
    const res2: any = {
      setHeader: (k: string, v: string) => {
        headersSet[k] = v;
      },
      status: (code: number) => {
        statusCode = code;
        return {
          json: (b: any) => {
            jsonBody = b;
          },
        };
      },
    };

    await middleware(req2, res2, next2);
    expect(next2).not.toHaveBeenCalled();
    expect(statusCode).toBe(402);
    expect(headersSet["PAYMENT-REQUIRED"]).toBeDefined();
    expect(jsonBody.accepts[0].asset).toBe("USDC-350c4e");
  });
});
