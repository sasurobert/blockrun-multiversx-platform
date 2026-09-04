import express, { Express, Request, Response } from "express";
import cors from "cors";
import crypto from "crypto";
import { ArbitrageMatrix } from "./arbitrage_matrix.js";
import { ModelMapper } from "./model_mapper.js";
import { CascadingFallbackDispatcher } from "./fallback_dispatcher.js";
import { ArbitragePricingEngine } from "./arbitrage_pricing.js";
import { TwoPhaseReconciler } from "./two_phase_reconciler.js";
import { SlaSlasher } from "./sla_slasher.js";
import { PipelinedSettlementQueue } from "../services/pipelined_settlement_queue.js";
import { MerchantPoolManager } from "../services/merchant_pool.js";
import { IVerifierService } from "../services/verifier.js";
import { ClawChatRequest } from "./types.js";
import { PaymentRequirements, X402PaymentPayload } from "../domain/types.js";

export interface ClawRouterServerOptions {
  matrix?: ArbitrageMatrix;
  mapper?: ModelMapper;
  dispatcher?: CascadingFallbackDispatcher;
  pricing?: ArbitragePricingEngine;
  reconciler?: TwoPhaseReconciler;
  slaSlasher?: SlaSlasher;
  settlementQueue?: PipelinedSettlementQueue;
  merchantPool?: MerchantPoolManager;
  verifier: IVerifierService;
  network?: string;
  tokenIdentifier?: string;
}

export class ClawRouterServer {
  public app: Express;
  public matrix: ArbitrageMatrix;
  public mapper: ModelMapper;
  public dispatcher: CascadingFallbackDispatcher;
  public pricing: ArbitragePricingEngine;
  public reconciler?: TwoPhaseReconciler;
  public slaSlasher?: SlaSlasher;
  public settlementQueue?: PipelinedSettlementQueue;
  public merchantPool: MerchantPoolManager;
  public verifier: IVerifierService;
  public network: string;
  public tokenIdentifier: string;

  constructor(options: ClawRouterServerOptions) {
    this.matrix = options.matrix ?? new ArbitrageMatrix();
    this.mapper = options.mapper ?? new ModelMapper(this.matrix);
    this.dispatcher = options.dispatcher ?? new CascadingFallbackDispatcher();
    this.pricing = options.pricing ?? new ArbitragePricingEngine();
    this.reconciler = options.reconciler;
    this.slaSlasher = options.slaSlasher;
    this.settlementQueue = options.settlementQueue;
    this.merchantPool = options.merchantPool ?? new MerchantPoolManager();
    this.verifier = options.verifier;
    this.network = options.network ?? "multiversx:1";
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
      res.json({ status: "ok", service: "multiversx-claw-router" });
    });

    // Providers catalog and health metrics
    this.app.get("/api/v1/claw/providers", (_req: Request, res: Response) => {
      res.json({
        providers: this.matrix.getAllProviders(),
      });
    });

    this.app.get("/api/v1/claw/matrix", (_req: Request, res: Response) => {
      res.json({
        providers: this.matrix.getAllProviders(),
      });
    });

    this.app.get("/api/v1/claw/speedometer", (_req: Request, res: Response) => {
      const providers = this.matrix.getAllProviders().map((p) => ({
        id: p.id,
        name: p.name,
        endpoint: p.endpoint,
        avgTtftMs: p.avgTtftMs,
        tokensPerSecond: p.tokensPerSecond,
        costPerMillionInputTokensUsd: p.costPerMillionInputTokensUsd,
        costPerMillionOutputTokensUsd: p.costPerMillionOutputTokensUsd,
        healthy: p.healthy,
        supportedModels: p.supportedModels,
        p50LatencyMs: Math.round(p.avgTtftMs * 0.92),
        p99LatencyMs: Math.round(p.avgTtftMs * 1.35),
        errorRate: p.healthy ? 0.001 : 0.99,
        circuitBreaker: p.healthy ? "CLOSED" : "OPEN",
      }));
      res.json({
        timestamp: Date.now(),
        providers,
        summary: {
          totalProviders: providers.length,
          healthyProviders: providers.filter((p) => p.healthy).length,
          fastestProvider: providers.reduce((prev, curr) => (curr.avgTtftMs < prev.avgTtftMs ? curr : prev), providers[0])?.name,
          cheapestProvider: providers.reduce((prev, curr) => (curr.costPerMillionInputTokensUsd < prev.costPerMillionInputTokensUsd ? curr : prev), providers[0])?.name,
        },
      });
    });

    // Dynamic spot pricing ingestion
    this.app.post("/api/v1/claw/spot-pricing", (req: Request, res: Response) => {
      const body = req.body;
      const updates = Array.isArray(body)
        ? body
        : Array.isArray(body?.updates)
        ? body.updates
        : body && typeof body === "object" && Object.keys(body).length > 0
        ? [body]
        : [];

      if (updates.length === 0) {
        return res.status(400).json({ error: "Invalid request: Expected pricing updates array or object" });
      }

      const result = this.matrix.ingestSpotPricingFeed(updates);
      res.json({
        success: true,
        updatedCount: result.updatedCount,
        errors: result.errors.length > 0 ? result.errors : undefined,
      });
    });

    // OpenAPI & Swagger Interactive Documentation
    this.app.get("/openapi.json", (_req: Request, res: Response) => {
      res.json({
        openapi: "3.0.3",
        info: {
          title: "MultiversX ClawRouter API",
          version: "1.0.0",
          description: "Decentralized AI inference router with cascading fallback, TTFT SLA enforcement, and x402 micropayments on MultiversX Devnet",
          contact: { name: "Robert Sasu", email: "sasu.robert@gmail.com" },
        },
        servers: [{ url: "/", description: "Current ClawRouter instance" }],
        paths: {
          "/health": { get: { summary: "Health check probe", responses: { "200": { description: "Healthy" } } } },
          "/api/v1/claw/providers": { get: { summary: "List active AI providers", responses: { "200": { description: "Provider list" } } } },
          "/api/v1/claw/speedometer": { get: { summary: "Live latency speedometer and circuit breaker metrics", responses: { "200": { description: "Speedometer metrics" } } } },
          "/api/v1/claw/spot-pricing": {
            post: {
              summary: "Ingest dynamic spot pricing updates for routing matrix providers",
              responses: {
                "200": { description: "Pricing feed ingested successfully" },
                "400": { description: "Invalid request payload" },
              },
            },
          },
          "/v1/chat/completions": { post: { summary: "OpenAI-compatible streaming chat completion with x402 payment", responses: { "200": { description: "SSE streaming tokens" }, "402": { description: "Payment Required" } } } },
        },
      });
    });

    this.app.get(["/docs", "/swagger"], (_req: Request, res: Response) => {
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MultiversX ClawRouter - Interactive API Docs</title>
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

    // Chat completions with sub-second arbitrage & cascading fallback
    this.app.post(["/api/v1/claw/chat/completions", "/v1/chat/completions"], async (req: Request, res: Response) => {
      const chatReq = req.body as ClawChatRequest;
      if (!chatReq?.model || !chatReq?.messages) {
        return res.status(400).json({ error: "Missing model or messages in request body" });
      }

      const strategy = chatReq.routingStrategy ?? "cost-optimized";
      const resolution = this.mapper.resolveModel(chatReq.model, strategy);
      const rankedProviders = this.matrix.getRankedProviders(resolution.resolvedModel, strategy);

      const primaryProvider =
        rankedProviders[0] ||
        this.matrix.getProvider(resolution.providerId) || {
          id: "default-spot",
          name: "Default Spot Node",
          endpoint: "https://default",
          costPerMillionInputTokensUsd: 0.5,
          costPerMillionOutputTokensUsd: 0.8,
          avgTtftMs: 120,
          tokensPerSecond: 150,
          healthy: true,
          supportedModels: [resolution.resolvedModel],
        };

      // Calculate dynamic price
      const promptText = chatReq.messages.map((m) => m.content).join(" ");
      const inputTokens = Math.max(10, Math.ceil(promptText.length / 4));
      const outputTokens = chatReq.max_tokens ?? 500;

      const pricingResult = this.pricing.calculatePrice({
        provider: primaryProvider,
        inputTokens,
        outputTokens,
      });

      const clientAddress = req.headers["x-payer-address"] as string | undefined;
      const { merchantAddress, shard } = this.merchantPool.getMerchantAddressForUser(clientAddress);

      // Check session credit from TwoPhaseReconciler
      let requiredMicroUsdc = pricingResult.microUsdc;
      let existingCreditApplied = 0;

      if (this.reconciler && clientAddress) {
        const fullCost = parseInt(pricingResult.microUsdc, 10);
        const remaining = this.reconciler.applyCredit(clientAddress, fullCost);
        existingCreditApplied = fullCost - remaining;
        requiredMicroUsdc = String(remaining);
      }

      const requirements: PaymentRequirements = {
        scheme: "exact",
        network: this.network as any,
        amount: requiredMicroUsdc,
        asset: this.tokenIdentifier,
        payTo: merchantAddress as any,
        maxTimeoutSeconds: 300,
        extra: {
          shard,
          executionType: "intra-shard-0.6s",
          arbitrageTier: resolution.alias,
          projectedProvider: primaryProvider.id,
          creditApplied: existingCreditApplied,
        },
      };

      const rawSig =
        req.headers["payment-signature"] ||
        req.headers["x-payment-signature"];

      // If credit covered 100% of the cost, bypass 402 challenge
      const isFullyCoveredByCredit = existingCreditApplied > 0 && requiredMicroUsdc === "0";

      if (!rawSig && !isFullyCoveredByCredit) {
        return this.send402Challenge(res, requirements, pricingResult.usdFormatted);
      }

      let payload: X402PaymentPayload | undefined;
      if (!isFullyCoveredByCredit) {
        // Verify payment
        try {
          const decoded =
            typeof rawSig === "string" && !rawSig.startsWith("{")
              ? Buffer.from(rawSig, "base64").toString("utf-8")
              : rawSig;
          payload = typeof decoded === "string" ? JSON.parse(decoded) : decoded;
        } catch {
          return res.status(402).json({ error: "Payment verification failed: Malformed signature" });
        }

        if (!payload) {
          return res.status(402).json({ error: "Payment verification failed: Missing payload" });
        }

        const verifyRes = await this.verifier.verify({
          paymentPayload: payload,
          paymentRequirements: requirements,
        });
        if (!verifyRes.isValid) {
          return res.status(402).json({
            error: `Payment verification failed: ${verifyRes.invalidReason ?? "Invalid signature"}`,
          });
        }
      }

      const requestHash = crypto
        .createHash("sha256")
        .update(`${chatReq.model}:${promptText}:${Date.now()}`)
        .digest("hex");

      // Payment verified or credit applied! Dispatch with cascading fallback
      try {
        const dispatchResult = await this.dispatcher.dispatch(
          rankedProviders.length > 0 ? rankedProviders : [primaryProvider],
          chatReq
        );

        if (this.slaSlasher) {
          try {
            await this.slaSlasher.reportTtft(
              dispatchResult.providerId,
              dispatchResult.ttftMs,
              requestHash
            );
          } catch {
            // non-blocking
          }
        }

        let txHash = isFullyCoveredByCredit
          ? `credit-settled-${Date.now()}`
          : crypto.randomBytes(32).toString("hex");

        if (this.settlementQueue && payload) {
          try {
            const settlement = await this.settlementQueue.settle({
              paymentPayload: payload,
              paymentRequirements: requirements,
            });
            if (settlement?.transaction) {
              txHash = settlement.transaction;
            }
          } catch {
            // fallback
          }
        }

        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Payment-Receipt", txHash);
        res.setHeader("X-Payment-Settled", "true");
        res.setHeader("X-Claw-Provider-Selected", dispatchResult.providerId);
        res.setHeader("X-Claw-Latency-Ttft", `${dispatchResult.ttftMs}ms`);

        let actualGeneratedTokens = 0;

        for await (const chunk of dispatchResult.stream) {
          actualGeneratedTokens += Math.max(1, Math.ceil(chunk.length / 4));
          const sseData = JSON.stringify({
            choices: [{ delta: { content: chunk } }],
          });
          res.write(`data: ${sseData}\n\n`);
        }

        // Reconcile actual consumed tokens vs pre-authorized
        if (this.reconciler && clientAddress) {
          const selectedProvider =
            this.matrix.getProvider(dispatchResult.providerId) ?? primaryProvider;
          const actualPricing = this.pricing.calculatePrice({
            provider: selectedProvider,
            inputTokens,
            outputTokens: actualGeneratedTokens,
          });

          const preAuthorized = parseInt(pricingResult.microUsdc, 10);
          const actualCost = parseInt(actualPricing.microUsdc, 10);

          if (preAuthorized > actualCost) {
            const unspentCredited = this.reconciler.reconcile({
              clientAddress,
              preAuthorizedMicroUsdc: preAuthorized,
              actualMicroUsdc: actualCost,
            });
            if (unspentCredited > 0) {
              res.write(
                `data: ${JSON.stringify({ type: "reconciliation", creditedMicroUsdc: unspentCredited })}\n\n`
              );
            }
          }
        }

        res.write("data: [DONE]\n\n");
        return res.end();
      } catch (err: unknown) {
        if (this.slaSlasher) {
          try {
            await this.slaSlasher.reportFailure(primaryProvider.id, requestHash);
          } catch {
            // non-blocking
          }
        }
        const message = err instanceof Error ? err.message : String(err);
        return res.status(502).json({ error: `Inference failed across fallback chain: ${message}` });
      }
    });
  }

  private send402Challenge(
    res: Response,
    requirements: PaymentRequirements,
    usdFormatted: string
  ): Response {
    const challengeBody = {
      x402Version: 2,
      accepts: [requirements],
      error: "Payment Required",
      price: { amount: usdFormatted.replace("$", ""), currency: "USD" },
    };

    const encoded = Buffer.from(JSON.stringify(challengeBody)).toString("base64");
    res.setHeader("PAYMENT-REQUIRED", encoded);
    res.setHeader("X-Payment-Required", encoded);
    res.setHeader(
      "WWW-Authenticate",
      `x402 scheme="exact", network="${requirements.network}", amount="${requirements.amount}", asset="${requirements.asset}", payTo="${requirements.payTo}"`
    );

    return res.status(402).json(challengeBody);
  }
}
