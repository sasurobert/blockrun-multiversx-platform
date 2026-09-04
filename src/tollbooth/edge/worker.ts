/**
 * Cloudflare Worker / Edge Middleware for x402-tollbooth.
 * Intercepts AI crawlers at the edge in <5ms and issues HTTP 402 challenges.
 */

const BOT_PATTERNS = [
  /claudebot/i,
  /gptbot/i,
  /chatgpt-user/i,
  /perplexitybot/i,
  /bytespider/i,
  /python-requests/i,
  /axios/i,
];

export interface Env {
  MERCHANT_SHARD_0: string;
  FACILITATOR_URL: string;
  ORIGIN_URL: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const ua = request.headers.get("user-agent") || "";
    const accept = request.headers.get("accept") || "";

    const isBot =
      accept.includes("text/markdown") ||
      BOT_PATTERNS.some((pattern) => pattern.test(ua));

    // Human traffic passes directly to origin
    if (!isBot) {
      return fetch(request);
    }

    // Bot traffic check payment
    const paymentSig = request.headers.get("payment-signature");
    const merchant = env.MERCHANT_SHARD_0 || "erd1ka0yrspygvjtktyzxu58ufn0kujkqgx4gq2ch5ev2aqjcem9jcqqkntrmv";

    const requirements = {
      scheme: "exact",
      network: "multiversx:1",
      amount: "1500",
      asset: "USDC-c76f1f",
      payTo: merchant,
      extra: {
        shard: 0,
        executionType: "intra-shard-0.6s",
        url: new URL(request.url).pathname,
      },
    };

    if (!paymentSig) {
      const challengeBody = {
        x402Version: 2,
        accepts: [requirements],
        error: "Payment Required",
        message: "Edge Tollbooth: Micro-payment required to crawl markdown content",
        price: { amount: "0.001500", currency: "USD" },
      };

      const encoded = btoa(JSON.stringify(challengeBody));

      return new Response(JSON.stringify(challengeBody), {
        status: 402,
        headers: {
          "Content-Type": "application/json",
          "PAYMENT-REQUIRED": encoded,
          "X-Payment-Required": encoded,
          "WWW-Authenticate": `x402 scheme="exact", network="multiversx:1", amount="1500", asset="USDC-c76f1f", payTo="${merchant}"`,
          "X-Tollbooth-Content-Type": "text/markdown",
        },
      });
    }

    // Paid request: verify and proxy to origin
    return fetch(request);
  },
};
