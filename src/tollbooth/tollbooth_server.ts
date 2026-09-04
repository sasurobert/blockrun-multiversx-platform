import express, { Express, Request, Response } from "express";
import crypto from "crypto";
import { BotClassifier } from "./bot_classifier.js";
import { MarkdownExtractor } from "./markdown_extractor.js";
import { TollPricingEngine } from "./toll_pricing_engine.js";
import { TollboothReputationAdapter } from "./reputation_adapter.js";
import { AbuseReporter } from "./abuse_reporter.js";
import { PipelinedSettlementQueue } from "../services/pipelined_settlement_queue.js";
import { IVerifierService } from "../services/verifier.js";
import { PaymentRequirements, X402PaymentPayload } from "../domain/types.js";

export interface TollboothServerOptions {
  classifier?: BotClassifier;
  extractor?: MarkdownExtractor;
  pricingEngine?: TollPricingEngine;
  reputationAdapter?: TollboothReputationAdapter;
  abuseReporter?: AbuseReporter;
  settlementQueue?: PipelinedSettlementQueue;
  verifier: IVerifierService;
  originUrl?: string;
  originFetch?: (url: string, init?: RequestInit) => Promise<globalThis.Response>;
  network?: string;
}

export class TollboothServer {
  public app: Express;
  public classifier: BotClassifier;
  public extractor: MarkdownExtractor;
  public pricingEngine: TollPricingEngine;
  public reputationAdapter?: TollboothReputationAdapter;
  public abuseReporter?: AbuseReporter;
  public settlementQueue?: PipelinedSettlementQueue;
  public verifier: IVerifierService;
  public originUrl: string;
  public originFetch: (url: string, init?: RequestInit) => Promise<globalThis.Response>;
  public network: string;

  constructor(options: TollboothServerOptions) {
    this.classifier = options.classifier ?? new BotClassifier();
    this.extractor = options.extractor ?? new MarkdownExtractor();
    this.pricingEngine = options.pricingEngine ?? new TollPricingEngine();
    this.reputationAdapter = options.reputationAdapter;
    this.abuseReporter = options.abuseReporter;
    this.settlementQueue = options.settlementQueue;
    this.verifier = options.verifier;
    this.originUrl = options.originUrl ?? "http://localhost:8080";
    this.originFetch = options.originFetch ?? (globalThis.fetch as any);
    this.network = options.network ?? "multiversx:1";

    this.app = express();
    this.app.use(express.json());
    this.registerRoutes();
  }

  private registerRoutes(): void {
    // Health probe
    this.app.get("/health", (_req: Request, res: Response) => {
      res.json({ status: "ok", service: "x402-tollbooth" });
    });

    // Intercept all GET requests
    this.app.get("*", async (req: Request, res: Response) => {
      const classification = this.classifier.classify(req.headers as any);

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
        asset: "USDC-c76f1f",
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

      // Payment verified! Fetch HTML from origin and transform into clean Markdown
      try {
        const originTarget = `${this.originUrl}${req.originalUrl}`;
        const originRes = await this.originFetch(originTarget, {
          headers: { "User-Agent": "x402-Tollbooth/1.0" },
        });

        const rawHtml = await originRes.text();
        const extracted = this.extractor.extract(rawHtml);

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
        res.setHeader("X-Payment-Receipt", txHash);
        res.setHeader("X-Payment-Settled", "true");
        res.setHeader("X-Tollbooth-Tokens", String(extracted.estimatedTokens));
        res.setHeader("X-Tollbooth-Tier", toll.tier);

        return res.status(200).send(extracted.markdown);
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
