/**
 * @sasurobert/tollbooth-edge
 * Drop-in Edge Middleware for MultiversX x402 Anti-Bot Scraper Tollbooth.
 * Intercepts AI crawlers (GPTBot, ClaudeBot, PerplexityBot) at CDN edge <5ms
 * and issues standard HTTP 402 payment challenges on MultiversX Devnet / Mainnet.
 */

export interface TollboothEdgeConfig {
  merchantAddress: string;
  network?: string; // Default: multiversx:D
  tokenId?: string; // Default: USDC-350c4e
  rateMicroUsdc?: string; // Default: 1500 ($0.0015)
  facilitatorUrl?: string; // Default: https://devnet-api.multiversx.com or facilitator endpoint
  allowHumanTraffic?: boolean; // Default: true
}

export const BOT_USER_AGENTS = [
  /claudebot/i,
  /gptbot/i,
  /chatgpt-user/i,
  /perplexitybot/i,
  /bytespider/i,
  /google-extended/i,
  /anthropic-ai/i,
  /cohere-ai/i,
  /diffbot/i,
  /scrapy/i,
  /python-requests/i,
  /axios/i,
];

/**
 * Cloudflare Worker / Edge runtime fetch handler.
 */
export function createTollboothEdgeHandler(config: TollboothEdgeConfig) {
  const network = config.network || "multiversx:D";
  const tokenId = config.tokenId || "USDC-350c4e";
  const rateMicroUsdc = config.rateMicroUsdc || "1500";
  const merchantAddress = config.merchantAddress;

  return async function handleFetch(
    request: Request,
    env?: Record<string, unknown>,
    ctx?: unknown
  ): Promise<Response> {
    const ua = request.headers.get("user-agent") || "";
    const accept = request.headers.get("accept") || "";

    const isBot =
      accept.includes("text/markdown") ||
      BOT_USER_AGENTS.some((pattern) => pattern.test(ua));

    // Humans bypass tollbooth to origin
    if (!isBot && config.allowHumanTraffic !== false) {
      return fetch(request);
    }

    // Check payment signature header
    const paymentSig =
      request.headers.get("payment-signature") ||
      request.headers.get("x-payment-signature");

    const requirements = {
      scheme: "exact",
      network,
      amount: rateMicroUsdc,
      asset: tokenId,
      payTo: merchantAddress,
      maxTimeoutSeconds: 300,
      extra: {
        executionType: "intra-shard-0.6s",
        url: new URL(request.url).pathname,
      },
    };

    if (!paymentSig) {
      const challengeBody = {
        x402Version: 2,
        accepts: [requirements],
        error: "Payment Required",
        message: "MultiversX Edge Tollbooth: Micro-payment required to crawl markdown content",
        price: {
          amount: (parseInt(rateMicroUsdc, 10) / 1e6).toFixed(6),
          currency: "USD",
        },
      };

      const encoded = btoa(JSON.stringify(challengeBody));

      return new Response(JSON.stringify(challengeBody), {
        status: 402,
        headers: {
          "Content-Type": "application/json",
          "PAYMENT-REQUIRED": encoded,
          "X-Payment-Required": encoded,
          "WWW-Authenticate": `x402 scheme="exact", network="${network}", amount="${rateMicroUsdc}", asset="${tokenId}", payTo="${merchantAddress}"`,
          "X-Tollbooth-Content-Type": "text/markdown",
        },
      });
    }

    // Paid bot request: forward to origin with payment signature preserved
    return fetch(request);
  };
}

/**
 * Standard Express / Node.js HTTP middleware.
 */
export function tollboothMiddleware(config: TollboothEdgeConfig) {
  const handler = createTollboothEdgeHandler(config);

  return async (req: any, res: any, next: any) => {
    const ua = req.headers["user-agent"] || "";
    const accept = req.headers["accept"] || "";

    const isBot =
      accept.includes("text/markdown") ||
      BOT_USER_AGENTS.some((pattern) => pattern.test(ua));

    if (!isBot && config.allowHumanTraffic !== false) {
      return next();
    }

    const paymentSig =
      req.headers["payment-signature"] ||
      req.headers["x-payment-signature"];

    const network = config.network || "multiversx:D";
    const tokenId = config.tokenId || "USDC-350c4e";
    const rateMicroUsdc = config.rateMicroUsdc || "1500";

    if (!paymentSig) {
      const requirements = {
        scheme: "exact",
        network,
        amount: rateMicroUsdc,
        asset: tokenId,
        payTo: config.merchantAddress,
        maxTimeoutSeconds: 300,
        extra: {
          executionType: "intra-shard-0.6s",
          url: req.originalUrl || req.url,
        },
      };

      const challengeBody = {
        x402Version: 2,
        accepts: [requirements],
        error: "Payment Required",
        message: "MultiversX Tollbooth: Micro-payment required to crawl content",
        price: {
          amount: (parseInt(rateMicroUsdc, 10) / 1e6).toFixed(6),
          currency: "USD",
        },
      };

      const encoded = Buffer.from(JSON.stringify(challengeBody)).toString("base64");
      res.setHeader("PAYMENT-REQUIRED", encoded);
      res.setHeader("X-Payment-Required", encoded);
      res.setHeader(
        "WWW-Authenticate",
        `x402 scheme="exact", network="${network}", amount="${rateMicroUsdc}", asset="${tokenId}", payTo="${config.merchantAddress}"`
      );
      res.setHeader("X-Tollbooth-Content-Type", "text/markdown");
      return res.status(402).json(challengeBody);
    }

    return next();
  };
}
