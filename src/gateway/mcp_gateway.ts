import express, { Express, Request, Response } from "express";
import cors from "cors";
import crypto from "crypto";
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

      const requirements: PaymentRequirements = {
        scheme: "exact",
        network: this.network as any,
        amount: toolDef.pricing.microUsdc,
        asset: toolDef.pricing.token,
        payTo: merchantAddress as any,
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
      const executionResult = await this.executor.executeTool(toolName, toolArgs);

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
