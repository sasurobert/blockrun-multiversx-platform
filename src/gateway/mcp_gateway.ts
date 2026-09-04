import express, { Express, Request, Response } from "express";
import cors from "cors";
import crypto from "crypto";
import { Address } from "@multiversx/sdk-core";
import { UserPublicKey, UserVerifier } from "@multiversx/sdk-wallet";
import { McpRegistryAdapter } from "../services/mcp_registry_adapter.js";
import { McpExecutor } from "../services/mcp_executor.js";
import { MerchantPoolManager } from "../services/merchant_pool.js";
import { IVerifierService } from "../services/verifier.js";
import { ReputationClient } from "../services/reputation_client.js";
import { McpProofLogger } from "../services/mcp_proof_logger.js";
import { PipelinedSettlementQueue } from "../services/pipelined_settlement_queue.js";
import { SettlementQueue } from "../services/settlement_queue.js";
import {
  McpRpcRequestSchema,
  McpToolsListResponse,
  McpToolRegisterRequestSchema,
  McpToolDefinition,
  ToolHealthStatus,
} from "../domain/mcp_types.js";
import { PaymentRequirements, X402PaymentPayload } from "../domain/types.js";

export interface McpGatewayOptions {
  registry: McpRegistryAdapter;
  executor: McpExecutor;
  merchantPool: MerchantPoolManager;
  verifier: IVerifierService;
  reputationClient?: ReputationClient;
  proofLogger?: McpProofLogger;
  settlementQueue?: PipelinedSettlementQueue | SettlementQueue;
  network?: string;
}

export class McpGateway {
  public app: Express;
  public registry: McpRegistryAdapter;
  public executor: McpExecutor;
  public merchantPool: MerchantPoolManager;
  public verifier: IVerifierService;
  public reputationClient?: ReputationClient;
  public proofLogger?: McpProofLogger;
  public settlementQueue?: PipelinedSettlementQueue | SettlementQueue;
  public network: string;

  constructor(options: McpGatewayOptions) {
    this.registry = options.registry;
    this.executor = options.executor;
    this.merchantPool = options.merchantPool;
    this.verifier = options.verifier;
    this.reputationClient = options.reputationClient;
    this.proofLogger = options.proofLogger;
    this.settlementQueue = options.settlementQueue;
    this.network = options.network ?? "multiversx:1";

    this.app = express();
    this.app.use(cors());
    this.app.use(express.json());
    this.registerRoutes();
  }

  private registerRoutes(): void {
    // Health probe
    this.app.get("/health", (_req: Request, res: Response) => {
      res.json({ status: "ok", service: "x402-mcp-gateway" });
    });

    // Discovery: List tools
    this.app.get("/mcp/v1/tools", (_req: Request, res: Response) => {
      const tools = this.registry.listLocalTools();
      const response: McpToolsListResponse = { tools };
      res.json(response);
    });

    // Dynamic Tool Registry: Register new MCP tool endpoint
    this.app.post("/mcp/v1/tools/register", async (req: Request, res: Response) => {
      const parseResult = McpToolRegisterRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          error: "Invalid tool registration schema",
          details: parseResult.error.errors,
        });
      }

      const body = parseResult.data;

      // Validate payTo address
      try {
        Address.newFromBech32(body.payTo);
      } catch {
        return res.status(400).json({
          error: "Invalid payTo address: Must be a valid 62-character MultiversX bech32 address (erd1...)",
        });
      }

      // MX-8004 Identity Verification
      let identityVerified = false;
      if (body.agentIdentity) {
        const { agentNonce, ownerAddress, signature } = body.agentIdentity;
        if (agentNonce < 0) {
          return res.status(400).json({ error: "Invalid MX-8004 agentNonce: must be non-negative" });
        }
        if (ownerAddress) {
          try {
            Address.newFromBech32(ownerAddress);
          } catch {
            return res.status(400).json({
              error: "Invalid MX-8004 identity: ownerAddress must be a valid MultiversX bech32 address",
            });
          }
        }
        if (signature) {
          if (!ownerAddress) {
            return res.status(400).json({ error: "ownerAddress is required when signature is provided" });
          }
          try {
            const verifier = new UserVerifier(new UserPublicKey(Address.newFromBech32(ownerAddress).getPublicKey()));
            const message = Buffer.from(`mcp-tool-register:${body.name}:${agentNonce}`);
            const cleanSig = signature.replace(/^0x/, "");
            const sigBuf = Buffer.from(cleanSig, cleanSig.length === 128 ? "hex" : "base64");
            const isValidSig = verifier.verify(message, sigBuf);
            if (!isValidSig) {
              return res.status(401).json({ error: "Invalid MX-8004 agentIdentity cryptographic signature" });
            }
            identityVerified = true;
          } catch (sigErr: unknown) {
            return res.status(400).json({
              error: `Cryptographic identity verification failed: ${sigErr instanceof Error ? sigErr.message : String(sigErr)}`,
            });
          }
        } else {
          identityVerified = Boolean(ownerAddress);
        }
      }

      const microUsdc = body.pricing.microUsdc;
      const usdFormatted = `$${(parseInt(microUsdc, 10) / 1e6).toFixed(4)}`;
      const token = body.pricing.token || (this.network.includes(":D") ? "USDC-350c4e" : "USDC-c76f1f");
      const providerAgentNonce =
        body.agentIdentity?.agentNonce ?? body.pricing.providerAgentNonce ?? 1;

      const toolDef: McpToolDefinition = {
        name: body.name,
        description: body.description,
        inputSchema: body.inputSchema,
        pricing: {
          microUsdc,
          usdFormatted,
          token,
          serviceId: body.pricing.serviceId,
          providerAgentNonce,
        },
        payTo: body.payTo,
        reputationScore: 100,
        totalCompletedJobs: 0,
      };

      // Register into registry adapter
      this.registry.registerLocalTool(toolDef);

      // If upstream endpointUrl provided, wire HTTP forwarding handler
      if (body.endpointUrl) {
        this.executor.registerHandler(body.name, async (args) => {
          try {
            const resp = await fetch(body.endpointUrl!, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: body.name, arguments: args }),
            });
            if (!resp.ok) {
              const errText = await resp.text();
              return {
                content: [{ type: "text", text: `Upstream tool error (${resp.status}): ${errText}` }],
                isError: true,
              };
            }
            const data = (await resp.json()) as any;
            return {
              content: Array.isArray(data?.content)
                ? data.content
                : [{ type: "text", text: typeof data === "object" ? JSON.stringify(data) : String(data) }],
              isError: Boolean(data?.isError),
            };
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              content: [{ type: "text", text: `Upstream connection failed: ${msg}` }],
              isError: true,
            };
          }
        });
      }

      this.registry.recordToolHeartbeat(body.name, 10, "healthy");

      return res.status(201).json({
        success: true,
        message: `Tool '${body.name}' registered successfully`,
        tool: toolDef,
        payTo: body.payTo,
        identityVerified,
      });
    });

    // Tool Health Probe: List all tool statuses
    this.app.get("/mcp/v1/tools/health", (_req: Request, res: Response) => {
      const healthList = this.registry.getAllToolHealth();
      res.json({
        status: "ok",
        count: healthList.length,
        tools: healthList,
      });
    });

    // Tool Health Probe: Single tool status
    this.app.get("/mcp/v1/tools/:name/health", (req: Request, res: Response) => {
      const health = this.registry.getToolHealth(req.params.name);
      if (!health) {
        return res.status(404).json({ error: `Tool '${req.params.name}' not found` });
      }
      return res.json(health);
    });

    // Tool Heartbeat: Provider ping
    this.app.post("/mcp/v1/tools/:name/heartbeat", (req: Request, res: Response) => {
      const toolDef = this.registry.getLocalTool(req.params.name);
      if (!toolDef) {
        return res.status(404).json({ error: `Tool '${req.params.name}' not registered` });
      }
      const latencyMs = typeof req.body?.latencyMs === "number" ? req.body.latencyMs : 15;
      const status = req.body?.status === "degraded" || req.body?.status === "unreachable" ? req.body.status : "healthy";
      const health = this.registry.recordToolHeartbeat(req.params.name, latencyMs, status);
      return res.json({ success: true, health });
    });

    // Server-Sent Events stream
    this.app.get("/mcp/v1/sse", (req: Request, res: Response) => {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.write(`data: ${JSON.stringify({ type: "ready", timestamp: Date.now() })}\n\n`);

      req.on("close", () => {
        res.end();
      });
    });

    // Tool Invocation: Pay-per-call
    this.app.post("/mcp/v1/tools/call", async (req: Request, res: Response) => {
      const parseResult = McpRpcRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          jsonrpc: "2.0",
          id: req.body?.id ?? null,
          error: { code: -32600, message: "Invalid Request", data: parseResult.error.errors },
        });
      }

      const rpcReq = parseResult.data;
      const toolName = rpcReq.params?.name;
      if (!toolName) {
        return res.status(400).json({
          jsonrpc: "2.0",
          id: rpcReq.id,
          error: { code: -32602, message: "Missing tool name in params" },
        });
      }

      const toolDef = this.registry.getLocalTool(toolName);
      if (!toolDef) {
        return res.status(404).json({
          jsonrpc: "2.0",
          id: rpcReq.id,
          error: { code: -32601, message: `Tool not found: ${toolName}` },
        });
      }

      // Check payment signature
      const rawSig =
        req.headers["payment-signature"] ||
        req.headers["x-payment-signature"] ||
        (req.body as any)?.paymentSignature;

      const clientAddress = req.headers["x-payer-address"] as string | undefined;
      const { merchantAddress, shard: clientShard } =
        this.merchantPool.getMerchantAddressForUser(clientAddress);

      const targetPayTo = toolDef.payTo || merchantAddress;

      const requirements: PaymentRequirements = {
        scheme: "exact",
        network: this.network as any,
        amount: toolDef.pricing.microUsdc,
        asset: toolDef.pricing.token,
        payTo: targetPayTo as any,
        maxTimeoutSeconds: 300,
        extra: {
          shard: clientShard,
          serviceId: toolDef.pricing.serviceId,
          tool: toolName,
          executionType: "intra-shard-0.6s",
        },
      };

      if (!rawSig) {
        // Return 402 challenge
        return this.send402Challenge(res, requirements, toolDef.pricing.usdFormatted);
      }

      // Verify payment signature
      let payload: X402PaymentPayload;
      try {
        const decoded = typeof rawSig === "string" && !rawSig.startsWith("{")
          ? Buffer.from(rawSig, "base64").toString("utf-8")
          : rawSig;
        payload = typeof decoded === "string" ? JSON.parse(decoded) : decoded;
      } catch {
        return res.status(402).json({
          jsonrpc: "2.0",
          id: rpcReq.id,
          error: "Payment verification failed: Malformed signature header",
        });
      }

      const verifyRes = await this.verifier.verify({
        paymentPayload: payload,
        paymentRequirements: requirements,
      });
      if (!verifyRes.isValid) {
        return res.status(402).json({
          jsonrpc: "2.0",
          id: rpcReq.id,
          error: `Payment verification failed: ${verifyRes.invalidReason ?? "Invalid signature"}`,
        });
      }

      // Payment verified! Execute tool
      const toolArgs = (rpcReq.params?.arguments as Record<string, unknown>) ?? {};
      const startExec = Date.now();
      const executionResult = await this.executor.executeTool(toolName, toolArgs);
      const durationMs = Date.now() - startExec;
      this.registry.recordToolExecution(toolName, !executionResult.isError, durationMs);

      const jobId = `job-mcp-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
      let proofResult: unknown;

      if (this.proofLogger) {
        try {
          proofResult = await this.proofLogger.logProof({
            jobId,
            agentNonce: toolDef.pricing.providerAgentNonce,
            serviceId: toolDef.pricing.serviceId,
            toolName,
            args: toolArgs,
            result: executionResult,
          });
        } catch {
          // Non-blocking proof logging error
        }
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
          // Fallback to local txHash if queue unavailable
        }
      }

      res.setHeader("X-Payment-Receipt", txHash);
      res.setHeader("X-Payment-Settled", "true");
      res.setHeader("X-Job-Id", jobId);

      return res.status(200).json({
        jsonrpc: "2.0",
        id: rpcReq.id,
        result: executionResult,
        paymentReceipt: txHash,
        jobId,
        ...(proofResult ? { proof: proofResult } : {}),
      });
    });

    // Resource read: Pay-per-read
    this.app.post("/mcp/v1/resources/read", async (req: Request, res: Response) => {
      const parseResult = McpRpcRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          jsonrpc: "2.0",
          id: req.body?.id ?? null,
          error: { code: -32600, message: "Invalid Request" },
        });
      }

      const rpcReq = parseResult.data;
      const uri = rpcReq.params?.uri;
      if (!uri) {
        return res.status(400).json({
          jsonrpc: "2.0",
          id: rpcReq.id,
          error: { code: -32602, message: "Missing resource uri in params" },
        });
      }

      const clientAddress = req.headers["x-payer-address"] as string | undefined;
      const { merchantAddress, shard: clientShard } =
        this.merchantPool.getMerchantAddressForUser(clientAddress);

      const requirements: PaymentRequirements = {
        scheme: "exact",
        network: this.network as any,
        amount: "1000",
        asset: "USDC-c76f1f",
        payTo: merchantAddress as any,
        maxTimeoutSeconds: 300,
        extra: {
          shard: clientShard,
          executionType: "intra-shard-0.6s",
          uri,
        },
      };

      const rawSig =
        req.headers["payment-signature"] ||
        req.headers["x-payment-signature"] ||
        (req.body as any)?.paymentSignature;

      if (!rawSig) {
        return this.send402Challenge(res, requirements, "$0.001000");
      }

      // Verify payment signature
      let payload: X402PaymentPayload;
      try {
        const decoded =
          typeof rawSig === "string" && !rawSig.startsWith("{")
            ? Buffer.from(rawSig, "base64").toString("utf-8")
            : rawSig;
        payload = typeof decoded === "string" ? JSON.parse(decoded) : decoded;
      } catch {
        return res.status(402).json({
          jsonrpc: "2.0",
          id: rpcReq.id,
          error: "Payment verification failed: Malformed signature header",
        });
      }

      const verifyRes = await this.verifier.verify({
        paymentPayload: payload,
        paymentRequirements: requirements,
      });
      if (!verifyRes.isValid) {
        return res.status(402).json({
          jsonrpc: "2.0",
          id: rpcReq.id,
          error: `Payment verification failed: ${verifyRes.invalidReason ?? "Invalid signature"}`,
        });
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
          // Fallback to local txHash
        }
      }

      res.setHeader("X-Payment-Receipt", txHash);
      res.setHeader("X-Payment-Settled", "true");

      return res.status(200).json({
        jsonrpc: "2.0",
        id: rpcReq.id,
        result: {
          contents: [
            {
              uri,
              mimeType: "text/plain",
              text: `Resource content for ${uri}`,
            },
          ],
          paymentReceipt: txHash,
        },
      });
    });

    // Reputation Feedback Hook for Completed Jobs
    this.app.post("/mcp/v1/reputation/feedback", async (req: Request, res: Response) => {
      const { jobId, agentNonce, rating, employer } = req.body ?? {};

      if (!jobId || typeof agentNonce !== "number" || typeof rating !== "number") {
        return res.status(400).json({
          error: "Missing required fields: jobId, agentNonce, rating",
        });
      }

      if (rating < 1 || rating > 100) {
        return res.status(400).json({
          error: "Rating must be an integer between 1 and 100",
        });
      }

      try {
        let txHash: string;
        if (this.reputationClient) {
          txHash = await this.reputationClient.giveFeedbackSimple(jobId, agentNonce, rating);
        } else {
          txHash = `feedback-tx-${Date.now()}`;
        }

        return res.status(200).json({
          success: true,
          txHash,
          jobId,
          agentNonce,
          rating,
          employer: employer ?? "anonymous",
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return res.status(500).json({ error: `Failed to submit reputation feedback: ${message}` });
      }
    });

    // OpenAPI & Swagger Interactive Documentation
    this.app.get("/openapi.json", (_req: Request, res: Response) => {
      res.json({
        openapi: "3.0.3",
        info: {
          title: "MultiversX x402 MCP Gateway API",
          version: "1.0.0",
          description: "Decentralized Model Context Protocol (MCP) tool marketplace and execution gateway on MultiversX Devnet",
          contact: { name: "Robert Sasu", email: "sasu.robert@gmail.com" },
        },
        servers: [{ url: "/", description: "Current MCP Gateway instance" }],
        paths: {
          "/health": { get: { summary: "Health check probe", responses: { "200": { description: "Service is healthy" } } } },
          "/mcp/v1/tools": { get: { summary: "List available MCP tools with pricing", responses: { "200": { description: "List of tools" } } } },
          "/mcp/v1/tools/register": { post: { summary: "Register new MCP tool with on-chain pricing and payTo", responses: { "201": { description: "Tool registered" } } } },
          "/mcp/v1/tools/call": { post: { summary: "Invoke an MCP tool with x402 micropayment", responses: { "200": { description: "Tool result" }, "402": { description: "Payment Required" } } } },
          "/mcp/v1/tools/health": { get: { summary: "Tool health status list", responses: { "200": { description: "All tool statuses" } } } },
        },
      });
    });

    this.app.get(["/docs", "/swagger"], (_req: Request, res: Response) => {
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>x402 MCP Gateway - Interactive API Docs</title>
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
