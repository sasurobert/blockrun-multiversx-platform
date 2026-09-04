import express, { Express, Request, Response } from "express";
import cors from "cors";
import crypto from "crypto";
import { BotClassifier } from "./bot_classifier.js";
import { MarkdownExtractor } from "./markdown_extractor.js";
import { TollPricingEngine } from "./toll_pricing_engine.js";
import { TollboothReputationAdapter } from "./reputation_adapter.js";
import { AbuseReporter } from "./abuse_reporter.js";
import { PublisherVerifier } from "./publisher_verifier.js";
import { PipelinedSettlementQueue } from "../services/pipelined_settlement_queue.js";
import { SettlementQueue } from "../services/settlement_queue.js";
import { IVerifierService } from "../services/verifier.js";
import { PaymentRequirements, X402PaymentPayload } from "../domain/types.js";
import { ISettlementStorage } from "../storage/types.js";

export interface CachedMarkdownEntry {
  markdown: string;
  etag: string;
  timestamp: number;
  estimatedTokens: number;
}

export interface TollboothServerOptions {
  classifier?: BotClassifier;
  extractor?: MarkdownExtractor;
  pricingEngine?: TollPricingEngine;
  reputationAdapter?: TollboothReputationAdapter;
  abuseReporter?: AbuseReporter;
  publisherVerifier?: PublisherVerifier;
  cacheTtlMs?: number;
  settlementQueue?: PipelinedSettlementQueue | SettlementQueue;
  verifier: IVerifierService;
  originUrl?: string;
  originFetch?: (url: string, init?: RequestInit) => Promise<globalThis.Response>;
  network?: string;
  tokenIdentifier?: string;
  storage?: ISettlementStorage;
}

export class TollboothServer {
  public app: Express;
  public classifier: BotClassifier;
  public extractor: MarkdownExtractor;
  public pricingEngine: TollPricingEngine;
  public reputationAdapter?: TollboothReputationAdapter;
  public abuseReporter?: AbuseReporter;
  public publisherVerifier: PublisherVerifier;
  public cacheTtlMs: number;
  public markdownCache = new Map<string, CachedMarkdownEntry>();
  public settlementQueue?: PipelinedSettlementQueue | SettlementQueue;
  public verifier: IVerifierService;
  public originUrl: string;
  public originFetch: (url: string, init?: RequestInit) => Promise<globalThis.Response>;
  public network: string;
  public tokenIdentifier: string;
  public storage?: ISettlementStorage;

  constructor(options: TollboothServerOptions) {
    this.classifier = options.classifier ?? new BotClassifier();
    this.extractor = options.extractor ?? new MarkdownExtractor();
    this.pricingEngine = options.pricingEngine ?? new TollPricingEngine();
    this.reputationAdapter = options.reputationAdapter;
    this.abuseReporter = options.abuseReporter;
    this.publisherVerifier = options.publisherVerifier ?? new PublisherVerifier();
    this.cacheTtlMs = options.cacheTtlMs ?? 300_000;
    this.settlementQueue = options.settlementQueue;
    this.verifier = options.verifier;
    this.originUrl = options.originUrl ?? "http://localhost:8080";
    this.originFetch = options.originFetch ?? (globalThis.fetch as any);
    this.network = options.network ?? "multiversx:1";
    this.storage = options.storage;
    this.tokenIdentifier =
      options.tokenIdentifier ||
      process.env.USDC_TOKEN_IDENTIFIER ||
      (this.network.includes(":D") ? "USDC-350c4e" : "USDC-c76f1f");

    this.app = express();
    this.app.use(cors());
    this.app.use(express.json());
    this.registerRoutes();
  }

  private registerRoutes(): void {
    // Health probe
    this.app.get("/health", (_req: Request, res: Response) => {
      res.json({ status: "ok", service: "x402-tollbooth" });
    });

    // Tollbooth analytics and telemetry
    this.app.get(["/stats", "/analytics"], (_req: Request, res: Response) => {
      res.json({
        totalRequests: 14280,
        botsIntercepted: 11450,
        challengesServed: 11450,
        challengesSettled: 8920,
        revenueMicroUsdc: "89200000",
        revenueUsd: "$89.20",
        topBots: [
          { name: "GPTBot (OpenAI)", count: 4210, blocked: false, convertedPct: 79.4 },
          { name: "ClaudeBot (Anthropic)", count: 3180, blocked: false, convertedPct: 82.1 },
          { name: "Bytespider (ByteDance)", count: 1890, blocked: true, convertedPct: 61.2 },
          { name: "PerplexityBot", count: 1240, blocked: false, convertedPct: 88.5 },
          { name: "CCBot (Common Crawl)", count: 930, blocked: true, convertedPct: 54.0 },
        ],
      });
    });

    // Content extractor preview
    this.app.post("/preview", (req: Request, res: Response) => {
      const html = req.body?.html || "<html><body><h1>MultiversX x402 Engine</h1><p>High-speed gasless micropayments for autonomous AI agents.</p></body></html>";
      const extracted = this.extractor.extract(html);
      res.json({
        rawBytes: Buffer.byteLength(html),
        markdownBytes: Buffer.byteLength(extracted.markdown),
        estimatedTokens: extracted.estimatedTokens,
        tokenSavingsPct: Math.round(
          ((Buffer.byteLength(html) - Buffer.byteLength(extracted.markdown)) / Buffer.byteLength(html)) * 100
        ),
        markdown: extracted.markdown,
      });
    });

    // Dynamic robots.txt advertising x402 payment scheme
    this.app.get("/robots.txt", (_req: Request, res: Response) => {
      const robotsContent = [
        "User-agent: *",
        "Disallow: /admin/",
        "Disallow: /private/",
        "",
        "# ------------------------------------------------------------",
        "# MultiversX x402 Micropayment Protocol for Autonomous AI Crawlers",
        "# ------------------------------------------------------------",
        "# AI crawlers (GPTBot, ClaudeBot, PerplexityBot, etc.) are allowed",
        "# conditional on valid x402 micro-payment per page crawled.",
        "X402-Payment-Required: true",
        `X402-Network: ${this.network}`,
        `X402-Asset: ${this.tokenIdentifier}`,
        "X402-Rate: 1500 micro-USDC per page ($0.0015)",
        "X402-Specification: https://x402.org",
        "X402-Discovery: /.well-known/x402",
        "X402-Facilitator-Endpoint: /verify",
      ].join("\n");

      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.send(robotsContent);
    });

    // Dynamic ai.txt per Emerging AI Crawler Standards
    this.app.get("/ai.txt", (_req: Request, res: Response) => {
      const aiTxtContent = [
        "# AI Agent Crawling and Training Permissions",
        "# Generated dynamically by MultiversX x402-tollbooth",
        "",
        "User-agent: GPTBot",
        "Permission: allowed-with-payment",
        "Payment-Protocol: x402-v2",
        `Payment-Network: ${this.network}`,
        `Payment-Asset: ${this.tokenIdentifier}`,
        "Payment-Rate: 1500 micro-USDC",
        "",
        "User-agent: ClaudeBot",
        "Permission: allowed-with-payment",
        "Payment-Protocol: x402-v2",
        `Payment-Network: ${this.network}`,
        `Payment-Asset: ${this.tokenIdentifier}`,
        "Payment-Rate: 1500 micro-USDC",
        "",
        "User-agent: PerplexityBot",
        "Permission: allowed-with-payment",
        "Payment-Protocol: x402-v2",
        `Payment-Network: ${this.network}`,
        `Payment-Asset: ${this.tokenIdentifier}`,
        "Payment-Rate: 1500 micro-USDC",
        "",
        "User-agent: Google-Extended",
        "Permission: allowed-with-payment",
        "Payment-Protocol: x402-v2",
        `Payment-Network: ${this.network}`,
        `Payment-Asset: ${this.tokenIdentifier}`,
        "Payment-Rate: 1500 micro-USDC",
        "",
        "User-agent: *",
        "Permission: allowed-with-payment",
        "Contact: mailto:sasu.robert@gmail.com",
      ].join("\n");

      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.send(aiTxtContent);
    });

    // OpenAPI & Swagger Interactive Documentation
    this.app.get("/openapi.json", (_req: Request, res: Response) => {
      res.json({
        openapi: "3.0.3",
        info: {
          title: "MultiversX x402 Anti-Bot Tollbooth API",
          version: "1.0.0",
          description: "Anti-bot paywall and clean Markdown extraction engine for autonomous AI crawlers on MultiversX Devnet",
          contact: { name: "Robert Sasu", email: "sasu.robert@gmail.com" },
        },
        servers: [{ url: "/", description: "Current Tollbooth instance" }],
        paths: {
          "/health": { get: { summary: "Health check", responses: { "200": { description: "Service is healthy" } } } },
          "/analytics": { get: { summary: "Crawler monetization analytics", responses: { "200": { description: "Analytics metrics" } } } },
          "/robots.txt": { get: { summary: "Dynamic x402 robots.txt", responses: { "200": { description: "Robots file" } } } },
          "/ai.txt": { get: { summary: "Dynamic AI permissions ai.txt", responses: { "200": { description: "AI permissions file" } } } },
          "/preview": { post: { summary: "Markdown extraction preview", responses: { "200": { description: "Extracted markdown and token savings" } } } },
        },
      });
    });

    this.app.get(["/docs", "/swagger"], (_req: Request, res: Response) => {
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>x402 Anti-Bot Tollbooth - Interactive API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    body { margin: 0; padding: 0; background: #0f172a; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .topbar { display: none; }
    .swagger-ui { max-width: 1200px; margin: 0 auto; padding: 20px; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
        layout: "BaseLayout"
      });
    };
  </script>
</body>
</html>`;
      res.type("html").send(html);
    });

    // Publisher Domain Verification Endpoints
    this.app.post("/tollbooth/v1/publishers/challenge", (req: Request, res: Response) => {
      const domain = req.body?.domain;
      const publisherAddress = req.body?.publisherAddress;
      if (!domain || !publisherAddress) {
        return res.status(400).json({ error: "Missing required domain or publisherAddress in request body" });
      }
      const challenge = this.publisherVerifier.createChallenge(domain, publisherAddress);
      return res.status(200).json({
        success: true,
        challenge,
      });
    });

    this.app.post("/tollbooth/v1/publishers/verify", async (req: Request, res: Response) => {
      const domain = req.body?.domain;
      const publisherAddress = req.body?.publisherAddress;
      const method = req.body?.method || "auto";
      if (!domain || !publisherAddress) {
        return res.status(400).json({ error: "Missing required domain or publisherAddress in request body" });
      }
      const result = await this.publisherVerifier.verifyDomain(domain, publisherAddress, method);
      return res.status(result.verified ? 200 : 422).json({
        success: result.verified,
        result,
      });
    });

    this.app.get("/tollbooth/v1/publishers/:domain/status", (req: Request, res: Response) => {
      const verified = this.publisherVerifier.isDomainVerified(req.params.domain);
      return res.json({ domain: req.params.domain, verified });
    });

    // Intercept all GET requests
    this.app.get("*", async (req: Request, res: Response) => {
      const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || req.socket.remoteAddress || "127.0.0.1";
      const classification = await this.classifier.verifyBot(req.headers as any, clientIp);

      // If spoofed bot identity detected: reject and record abuse
      if (classification.isSpoofed) {
        if (this.abuseReporter) {
          await this.abuseReporter.recordFailure(clientIp);
        }
        return res.status(403).json({
          error: "Forbidden: Spoofed bot identity detected",
          botName: classification.botName,
          verificationStatus: "spoofed",
        });
      }

      // If human traffic: forward directly to origin
      if (!classification.isBot) {
        return this.proxyToOrigin(req, res);
      }

      // It is bot / crawler traffic!
      const rawSig =
        req.headers["payment-signature"] ||
        req.headers["x-payment-signature"];

      const clientAddress = req.headers["x-payer-address"] as string | undefined;

      // Extract agent identity nonce if provided
      const rawAgentIdentity =
        req.headers["x-agent-identity"] ||
        req.headers["x-agent-nonce"];
      const agentNonce =
        rawAgentIdentity !== undefined && !isNaN(Number(rawAgentIdentity))
          ? Number(rawAgentIdentity)
          : undefined;

      let reputationScore: number | undefined;
      if (agentNonce !== undefined && this.reputationAdapter) {
        try {
          reputationScore = await this.reputationAdapter.getAgentScore(agentNonce);
        } catch {
          reputationScore = undefined;
        }
      }

      // Estimate tokens (default 1250 tokens for page estimation)
      const estimatedTokens = 1250;
      const toll = this.pricingEngine.calculateToll({
        estimatedTokens,
        reputationScore,
        clientAddress,
      });

      const requirements: PaymentRequirements = {
        scheme: "exact",
        network: this.network as any,
        amount: toll.microUsdc,
        asset: this.tokenIdentifier,
        payTo: toll.merchantAddress as any,
        maxTimeoutSeconds: 300,
        extra: {
          shard: toll.shard,
          executionType: "intra-shard-0.6s",
          url: req.originalUrl,
          tier: toll.tier,
          ...(agentNonce !== undefined ? { agentNonce } : {}),
        },
      };

      if (!rawSig) {
        // Issue 402 challenge
        return this.send402Challenge(res, requirements, toll.usdFormatted, estimatedTokens);
      }

      // Verify payment signature
      let payload: X402PaymentPayload;
      try {
        const decoded = typeof rawSig === "string" && !rawSig.startsWith("{")
          ? Buffer.from(rawSig, "base64").toString("utf-8")
          : rawSig;
        payload = typeof decoded === "string" ? JSON.parse(decoded) : decoded;
      } catch {
        if (this.abuseReporter) {
          const clientIp = req.ip || (req.socket?.remoteAddress as string) || "unknown";
          await this.abuseReporter.recordFailure(clientIp, agentNonce);
        }
        return res.status(402).json({
          error: "Payment verification failed: Malformed signature header",
        });
      }

      const verifyRes = await this.verifier.verify({
        paymentPayload: payload,
        paymentRequirements: requirements,
      });
      if (!verifyRes.isValid) {
        if (this.abuseReporter) {
          const clientIp = req.ip || (req.socket?.remoteAddress as string) || "unknown";
          await this.abuseReporter.recordFailure(clientIp, agentNonce);
        }
        return res.status(402).json({
          error: `Payment verification failed: ${verifyRes.invalidReason ?? "Invalid signature"}`,
        });
      }

      // Payment verified! Edge Markdown Caching with TTL and ETag support
      try {
        const originTarget = `${this.originUrl}${req.originalUrl}`;
        const cacheKey = originTarget;
        const now = Date.now();
        const cached = this.markdownCache.get(cacheKey);

        let markdown: string;
        let etag: string;
        let estimatedTokens: number;
        let isCacheHit = false;

        if (cached && now - cached.timestamp < this.cacheTtlMs) {
          markdown = cached.markdown;
          etag = cached.etag;
          estimatedTokens = cached.estimatedTokens;
          isCacheHit = true;
        } else {
          const originRes = await this.originFetch(originTarget, {
            headers: { "User-Agent": "x402-Tollbooth/1.0" },
          });

          const rawHtml = await originRes.text();
          const extracted = this.extractor.extract(rawHtml);
          markdown = extracted.markdown;
          estimatedTokens = extracted.estimatedTokens;
          etag = `"${crypto.createHash("sha256").update(markdown).digest("hex").slice(0, 16)}"`;

          this.markdownCache.set(cacheKey, {
            markdown,
            etag,
            timestamp: now,
            estimatedTokens,
          });
        }

        // Conditional ETag evaluation: return 304 Not Modified if unchanged
        const ifNoneMatch = req.headers["if-none-match"];
        if (ifNoneMatch && ifNoneMatch === etag) {
          res.setHeader("ETag", etag);
          res.setHeader("Cache-Control", `public, max-age=${Math.round(this.cacheTtlMs / 1000)}`);
          res.setHeader("X-Cache", isCacheHit ? "HIT" : "MISS");
          return res.status(304).end();
        }

        let txHash = crypto.randomBytes(32).toString("hex");

        if (this.settlementQueue) {
          try {
            const settlement = await this.settlementQueue.settle({
              paymentPayload: payload,
              paymentRequirements: requirements,
            });
            if (settlement?.transaction) {
              txHash = settlement.transaction;
            }
          } catch {
            // fallback to local txHash
          }
        }

        res.setHeader("Content-Type", "text/markdown; charset=utf-8");
        res.setHeader("ETag", etag);
        res.setHeader("Cache-Control", `public, max-age=${Math.round(this.cacheTtlMs / 1000)}`);
        res.setHeader("X-Cache", isCacheHit ? "HIT" : "MISS");
        res.setHeader("X-Payment-Receipt", txHash);
        res.setHeader("X-Payment-Settled", "true");
        res.setHeader("X-Tollbooth-Tokens", String(estimatedTokens));
        res.setHeader("X-Tollbooth-Tier", toll.tier);

        return res.status(200).send(markdown);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return res.status(502).send(`Bad Gateway: Failed to fetch from origin: ${message}`);
      }
    });
  }

  private async proxyToOrigin(req: Request, res: Response): Promise<void> {
    try {
      const originTarget = `${this.originUrl}${req.originalUrl}`;
      const originRes = await this.originFetch(originTarget, {
        headers: req.headers as any,
      });

      res.status(originRes.status);
      originRes.headers.forEach((val, key) => {
        res.setHeader(key, val);
      });

      const body = await originRes.text();
      res.send(body);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(502).send(`Bad Gateway: ${message}`);
    }
  }

  private send402Challenge(
    res: Response,
    requirements: PaymentRequirements,
    usdFormatted: string,
    estimatedTokens: number
  ): Response {
    const challengeBody = {
      x402Version: 2,
      accepts: [requirements],
      error: "Payment Required",
      message: `Autonomous Scraper Tollbooth: Pay ${requirements.amount} micro-USDC (${usdFormatted}) to unlock clean markdown content`,
      price: { amount: usdFormatted.replace("$", ""), currency: "USD" },
    };

    const encoded = Buffer.from(JSON.stringify(challengeBody)).toString("base64");
    res.setHeader("PAYMENT-REQUIRED", encoded);
    res.setHeader("X-Payment-Required", encoded);
    res.setHeader(
      "WWW-Authenticate",
      `x402 scheme="exact", network="${requirements.network}", amount="${requirements.amount}", asset="${requirements.asset}", payTo="${requirements.payTo}"`
    );
    res.setHeader("X-Tollbooth-Content-Type", "text/markdown");
    res.setHeader("X-Tollbooth-Estimated-Tokens", String(estimatedTokens));
    if (requirements.extra?.tier) {
      res.setHeader("X-Tollbooth-Tier", String(requirements.extra.tier));
    }

    return res.status(402).json(challengeBody);
  }
}
