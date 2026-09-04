import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import http from "http";
import { Mnemonic, UserSigner } from "@multiversx/sdk-wallet";
import { McpGateway } from "../../src/gateway/mcp_gateway.js";
import { McpRegistryAdapter } from "../../src/services/mcp_registry_adapter.js";
import { McpExecutor } from "../../src/services/mcp_executor.js";
import { MerchantPoolManager } from "../../src/services/merchant_pool.js";
import { IVerifierService } from "../../src/services/verifier.js";
import { McpProofLogger } from "../../src/services/mcp_proof_logger.js";
import { McpEscrowAdapter } from "../../src/services/mcp_escrow_adapter.js";
import { ReputationClient } from "../../src/services/reputation_client.js";
import { VerifyResponse, PaymentErrorCode } from "../../src/domain/types.js";

class MockVerifier implements IVerifierService {
  public shouldSucceed = true;
  public payerAddress = "erd1client000000000000000000000000000000000000000000000000000000";

  async verify(): Promise<VerifyResponse> {
    if (this.shouldSucceed) {
      return {
        isValid: true,
        payer: this.payerAddress,
        network: "multiversx:1",
      };
    }
    return {
      isValid: false,
      errorCode: PaymentErrorCode.INVALID_SIGNATURE,
      errorMessage: "Invalid signature",
    };
  }
}

describe("McpGateway (TDD)", () => {
  let registry: McpRegistryAdapter;
  let executor: McpExecutor;
  let merchantPool: MerchantPoolManager;
  let verifier: MockVerifier;
  let proofLogger: McpProofLogger;
  let reputationClient: ReputationClient;
  let gateway: McpGateway;
  let server: http.Server;
  let mockLogProof: any;
  let mockGiveFeedback: any;

  beforeEach(async () => {
    registry = new McpRegistryAdapter();
    registry.registerLocalTool({
      name: "multiversx-analyzer",
      description: "Smart contract analyzer",
      inputSchema: { type: "object" },
      pricing: {
        microUsdc: "5000",
        usdFormatted: "$0.005000",
        token: "USDC-c76f1f",
        serviceId: 101,
        providerAgentNonce: 42,
      },
    });

    executor = new McpExecutor();
    executor.registerHandler("multiversx-analyzer", async () => {
      return {
        content: [{ type: "text", text: "Analysis: Contract is safe." }],
        isError: false,
      };
    });

    merchantPool = new MerchantPoolManager();
    verifier = new MockVerifier();

    mockLogProof = vi.fn().mockResolvedValue({
      txHashInit: "init-tx-1",
      txHashProof: "proof-tx-1",
      proofDigest: "sha-digest",
    });
    proofLogger = new McpProofLogger({
      initJobFn: async () => "init-tx-1",
      submitProofFn: async () => "proof-tx-1",
    });
    proofLogger.logProof = mockLogProof;

    mockGiveFeedback = vi.fn().mockResolvedValue("feedback-tx-123");
    reputationClient = new ReputationClient({
      giveFeedbackSimpleFn: mockGiveFeedback,
    });

    gateway = new McpGateway({
      registry,
      executor,
      merchantPool,
      verifier,
      proofLogger,
      reputationClient,
      network: "multiversx:1",
    });

    await new Promise<void>((resolve) => {
      server = gateway.app.listen(0, "127.0.0.1", () => resolve());
    });
  });

  afterEach(async () => {
    if (server) {
      server.closeAllConnections?.();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  describe("GET /mcp/v1/tools", () => {
    it("should return the list of available tools with pricing", async () => {
      const res = await request(server).get("/mcp/v1/tools");
      expect(res.status).toBe(200);
      expect(res.body.tools).toBeInstanceOf(Array);
      expect(res.body.tools.length).toBe(1);
      expect(res.body.tools[0].name).toBe("multiversx-analyzer");
      expect(res.body.tools[0].pricing.microUsdc).toBe("5000");
    });
  });

  describe("POST /mcp/v1/tools/call without payment", () => {
    it("should return HTTP 402 Payment Required challenge with standard x402 headers", async () => {
      const res = await request(server)
        .post("/mcp/v1/tools/call")
        .send({
          jsonrpc: "2.0",
          id: "req-1",
          method: "tools/call",
          params: {
            name: "multiversx-analyzer",
            arguments: { address: "erd1qqqqqqqqqqqqqpgqak8zt22wl2ph4622up82t098pknqq6cvjcqq8p5w8s" },
          },
        });

      expect(res.status).toBe(402);
      expect(res.headers["payment-required"]).toBeDefined();
      expect(res.headers["www-authenticate"]).toContain("x402");
      expect(res.body.x402Version).toBe(2);
      expect(res.body.accepts[0].amount).toBe("5000");
      expect(res.body.accepts[0].asset).toBe("USDC-c76f1f");
      expect(res.body.accepts[0].payTo).toBeDefined();
    });

    it("should return 404 if tool does not exist", async () => {
      const res = await request(server)
        .post("/mcp/v1/tools/call")
        .send({
          jsonrpc: "2.0",
          id: "req-2",
          method: "tools/call",
          params: {
            name: "unknown-tool",
            arguments: {},
          },
        });

      expect(res.status).toBe(404);
      expect(res.body.error.message).toContain("Tool not found");
    });
  });

  describe("POST /mcp/v1/tools/call with payment", () => {
    it("should execute tool, log proof, and return JSON-RPC result with payment receipt when valid signature is provided", async () => {
      const dummySig = Buffer.from(
        JSON.stringify({
          x402Version: 2,
          network: "multiversx:1",
          scheme: "exact",
          payload: {
            nonce: 1,
            value: "0",
            receiver: "erd1ka0yrspygvjtktyzxu58ufn0kujkqgx4gq2ch5ev2aqjcem9jcqqkntrmv",
            sender: verifier.payerAddress,
            gasPrice: 1000000000,
            gasLimit: 300000,
            chainID: "1",
            version: 2,
            options: 0,
            signature: "sig",
          },
        })
      ).toString("base64");

      const res = await request(server)
        .post("/mcp/v1/tools/call")
        .set("PAYMENT-SIGNATURE", dummySig)
        .send({
          jsonrpc: "2.0",
          id: "req-paid-1",
          method: "tools/call",
          params: {
            name: "multiversx-analyzer",
            arguments: { address: "erd1test" },
          },
        });

      expect(res.status).toBe(200);
      expect(res.headers["x-payment-settled"]).toBe("true");
      expect(res.headers["x-payment-receipt"]).toBeDefined();
      expect(res.headers["x-job-id"]).toBeDefined();
      expect(res.body.jsonrpc).toBe("2.0");
      expect(res.body.id).toBe("req-paid-1");
      expect(res.body.result.content[0].text).toContain("Contract is safe");
      expect(res.body.paymentReceipt).toBeDefined();
      expect(mockLogProof).toHaveBeenCalled();
    });

    it("should reject invalid payment signature with 401/402", async () => {
      verifier.shouldSucceed = false;

      const res = await request(server)
        .post("/mcp/v1/tools/call")
        .set("PAYMENT-SIGNATURE", "invalid-base64")
        .send({
          jsonrpc: "2.0",
          id: "req-fail",
          method: "tools/call",
          params: {
            name: "multiversx-analyzer",
            arguments: {},
          },
        });

      expect(res.status).toBe(402);
      expect(res.body.error).toContain("Payment verification failed");
    });
  });

  describe("POST /mcp/v1/resources/read", () => {
    it("should issue 402 challenge when unpaid", async () => {
      const res = await request(server)
        .post("/mcp/v1/resources/read")
        .send({
          jsonrpc: "2.0",
          id: "res-1",
          method: "resources/read",
          params: { uri: "multiversx://schema/esdt" },
        });

      expect(res.status).toBe(402);
      expect(res.headers["payment-required"]).toBeDefined();
      expect(res.body.accepts[0].amount).toBe("1000");
    });

    it("should return content on valid payment signature", async () => {
      const validSig = Buffer.from(
        JSON.stringify({
          x402Version: 2,
          network: "multiversx:1",
          scheme: "exact",
          payload: {
            nonce: 2,
            value: "0",
            receiver: "erd1ka0yrspygvjtktyzxu58ufn0kujkqgx4gq2ch5ev2aqjcem9jcqqkntrmv",
            sender: verifier.payerAddress,
            signature: "valid-sig",
          },
        })
      ).toString("base64");

      const res = await request(server)
        .post("/mcp/v1/resources/read")
        .set("PAYMENT-SIGNATURE", validSig)
        .send({
          jsonrpc: "2.0",
          id: "res-2",
          method: "resources/read",
          params: { uri: "multiversx://schema/esdt" },
        });

      expect(res.status).toBe(200);
      expect(res.headers["x-payment-settled"]).toBe("true");
      expect(res.body.result.contents[0].uri).toBe("multiversx://schema/esdt");
      expect(res.body.result.contents[0].text).toContain("Resource content for multiversx://schema/esdt");
    });

    it("should reject invalid payment signature on resource read", async () => {
      verifier.shouldSucceed = false;

      const res = await request(server)
        .post("/mcp/v1/resources/read")
        .set("PAYMENT-SIGNATURE", "invalid-sig")
        .send({
          jsonrpc: "2.0",
          id: "res-fail",
          method: "resources/read",
          params: { uri: "multiversx://schema/esdt" },
        });

      expect(res.status).toBe(402);
      expect(res.body.error).toContain("Payment verification failed");
    });
  });

  describe("POST /mcp/v1/reputation/feedback", () => {
    it("should forward rating to ReputationClient and return 200 with txHash", async () => {
      const res = await request(server)
        .post("/mcp/v1/reputation/feedback")
        .send({
          jobId: "job-mcp-123",
          agentNonce: 42,
          rating: 95,
          employer: "erd1client000000000000000000000000000000000000000000000000000000",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.txHash).toBe("feedback-tx-123");
      expect(mockGiveFeedback).toHaveBeenCalledWith("job-mcp-123", 42, 95);
    });

    it("should reject invalid rating (< 1 or > 100)", async () => {
      const res = await request(server)
        .post("/mcp/v1/reputation/feedback")
        .send({
          jobId: "job-mcp-123",
          agentNonce: 42,
          rating: 105,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Rating must be an integer between 1 and 100");
    });
  });

  describe("Dynamic Tool Registry & Health Probes", () => {
    const validPayTo = "erd123g08w7g2p9qxynfhplxukearq68uyqn2fvepyyf33pd40ea95as02yv3k";
    const validOwner = "erd1ka0yrspygvjtktyzxu58ufn0kujkqgx4gq2ch5ev2aqjcem9jcqqkntrmv";

    it("should dynamically register a new tool with pricing and MX-8004 identity", async () => {
      const toolPayload = {
        name: "dynamic-calculator",
        description: "High speed compute oracle",
        inputSchema: { type: "object" },
        pricing: {
          microUsdc: "12500",
          token: "USDC-350c4e",
          serviceId: 5,
          providerAgentNonce: 88,
        },
        payTo: validPayTo,
        agentIdentity: {
          agentNonce: 88,
          ownerAddress: validOwner,
        },
      };

      const res = await request(server)
        .post("/mcp/v1/tools/register")
        .send(toolPayload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.tool.name).toBe("dynamic-calculator");
      expect(res.body.tool.pricing.microUsdc).toBe("12500");
      expect(res.body.identityVerified).toBe(true);

      // Verify discovery list
      const listRes = await request(server).get("/mcp/v1/tools");
      expect(listRes.status).toBe(200);
      const found = listRes.body.tools.find((t: any) => t.name === "dynamic-calculator");
      expect(found).toBeDefined();
    });

    it("should reject invalid payTo or invalid agentIdentity", async () => {
      const resBadPayTo = await request(server)
        .post("/mcp/v1/tools/register")
        .send({
          name: "bad-tool",
          description: "desc",
          pricing: { microUsdc: "1000" },
          payTo: "bad-address",
        });
      expect(resBadPayTo.status).toBe(400);

      // Address has 62 chars and starts with erd1, but invalid bech32 checksum
      const resBadChecksum = await request(server)
        .post("/mcp/v1/tools/register")
        .send({
          name: "bad-checksum-tool",
          description: "desc",
          pricing: { microUsdc: "1000" },
          payTo: "erd1" + "a".repeat(58),
        });
      expect(resBadChecksum.status).toBe(400);
      expect(resBadChecksum.body.error).toContain("Invalid payTo address");

      const resBadIdentity = await request(server)
        .post("/mcp/v1/tools/register")
        .send({
          name: "bad-tool-2",
          description: "desc",
          pricing: { microUsdc: "1000" },
          payTo: validPayTo,
          agentIdentity: { agentNonce: -1 },
        });
      expect(resBadIdentity.status).toBe(400);
    });

    it("should return health status list and single tool health", async () => {
      const resAll = await request(server).get("/mcp/v1/tools/health");
      expect(resAll.status).toBe(200);
      expect(resAll.body.status).toBe("ok");
      expect(Array.isArray(resAll.body.tools)).toBe(true);

      const resSingle = await request(server).get("/mcp/v1/tools/multiversx-analyzer/health");
      expect(resSingle.status).toBe(200);
      expect(resSingle.body.name).toBe("multiversx-analyzer");
      expect(resSingle.body.status).toBe("healthy");

      const res404 = await request(server).get("/mcp/v1/tools/missing-tool/health");
      expect(res404.status).toBe(404);
    });

    it("should record tool heartbeat and update status", async () => {
      const res = await request(server)
        .post("/mcp/v1/tools/multiversx-analyzer/heartbeat")
        .send({ latencyMs: 22, status: "healthy" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.health.latencyMs).toBe(22);
    });

    it("should route 402 payment requirements to the tool's registered payTo address", async () => {
      const toolPayload = {
        name: "custom-payto-tool",
        description: "Tool with custom merchant address",
        pricing: {
          microUsdc: "7500",
          token: "USDC-350c4e",
        },
        payTo: validPayTo,
      };

      await request(server).post("/mcp/v1/tools/register").send(toolPayload);

      // Invoke tool without payment to get 402 challenge
      const callRes = await request(server)
        .post("/mcp/v1/tools/call")
        .send({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "custom-payto-tool", arguments: {} },
        });

      expect(callRes.status).toBe(402);
      expect(callRes.body.accepts[0].payTo).toBe(validPayTo);
      expect(callRes.body.accepts[0].amount).toBe("7500");
    });

    it("should reject forged or invalid MX-8004 agentIdentity cryptographic signature", async () => {
      const res = await request(server)
        .post("/mcp/v1/tools/register")
        .send({
          name: "forged-tool",
          description: "desc",
          pricing: { microUsdc: "5000" },
          payTo: validPayTo,
          agentIdentity: {
            agentNonce: 1,
            ownerAddress: validOwner,
            signature: "00".repeat(64), // Invalid forged signature
          },
        });

      expect([400, 401]).toContain(res.status);
    });

    it("should serve interactive API documentation at /docs and /openapi.json", async () => {
      const docsRes = await request(server).get("/docs");
      expect(docsRes.status).toBe(200);
      expect(docsRes.text).toContain("SwaggerUIBundle");

      const swaggerRes = await request(server).get("/swagger");
      expect(swaggerRes.status).toBe(200);

      const openapiRes = await request(server).get("/openapi.json");
      expect(openapiRes.status).toBe(200);
      expect(openapiRes.body.openapi).toBe("3.0.3");
      expect(openapiRes.body.info.title).toContain("MCP Gateway");
    });

    it("should prevent tool name hijacking when another payTo attempts to overwrite existing tool", async () => {
      const originalPayload = {
        name: "protected-security-scanner",
        description: "Original tool",
        pricing: { microUsdc: "10000" },
        payTo: validPayTo,
      };

      const reg1 = await request(server).post("/mcp/v1/tools/register").send(originalPayload);
      expect(reg1.status).toBe(201);

      // Hijacker attempts to register with different payTo address
      const hijackerSigner = new UserSigner(Mnemonic.generate().deriveKey(0));
      const hijackerPayTo = hijackerSigner.getAddress().bech32();
      const hijackAttempt = await request(server).post("/mcp/v1/tools/register").send({
        name: "protected-security-scanner",
        description: "Hijacked tool",
        pricing: { microUsdc: "50000" },
        payTo: hijackerPayTo,
      });

      expect(hijackAttempt.status).toBe(403);
      expect(hijackAttempt.body.error).toContain("Tool name hijacking detected");
    });

    it("should prevent price tampering without cryptographic signature proof and accept valid Ed25519 signature", async () => {
      const ownerMnemonic = Mnemonic.generate();
      const ownerSigner = new UserSigner(ownerMnemonic.deriveKey(0));
      const ownerAddress = ownerSigner.getAddress().bech32();

      const initPayload = {
        name: "tamper-proof-oracle",
        description: "Original oracle tool",
        pricing: { microUsdc: "5000" },
        payTo: ownerAddress,
      };

      const initRes = await request(server).post("/mcp/v1/tools/register").send(initPayload);
      expect(initRes.status).toBe(201);

      // Attempt to tamper price without signature
      const tamperAttempt = await request(server).post("/mcp/v1/tools/register").send({
        name: "tamper-proof-oracle",
        description: "Tampered oracle",
        pricing: { microUsdc: "99000" },
        payTo: ownerAddress,
      });

      expect(tamperAttempt.status).toBe(401);
      expect(tamperAttempt.body.error).toContain("Cryptographic signature proof from payTo address");

      // Sign message with owner's UserSigner to authorize price update
      const msg = Buffer.from(`mcp-tool-register:tamper-proof-oracle:99000:${ownerAddress}`);
      const validSig = (await ownerSigner.sign(msg)).toString("hex");

      const updateRes = await request(server).post("/mcp/v1/tools/register").send({
        name: "tamper-proof-oracle",
        description: "Legitimate updated oracle",
        pricing: { microUsdc: "99000" },
        payTo: ownerAddress,
        signature: validSig,
      });

      expect(updateRes.status).toBe(201);
      expect(updateRes.body.success).toBe(true);
      expect(updateRes.body.tool.pricing.microUsdc).toBe("99000");

      // Attempt to tamper with signature from an attacker ownerAddress that differs from payTo
      const attackerMnemonic = Mnemonic.generate();
      const attackerSigner = new UserSigner(attackerMnemonic.deriveKey(0));
      const attackerAddress = attackerSigner.getAddress().bech32();
      const attackerSig = (await attackerSigner.sign(Buffer.from(`mcp-tool-register:tamper-proof-oracle`))).toString("hex");

      const spoofAttempt = await request(server).post("/mcp/v1/tools/register").send({
        name: "tamper-proof-oracle",
        description: "Spoofed oracle update",
        pricing: { microUsdc: "1000" },
        payTo: ownerAddress,
        agentIdentity: {
          agentNonce: 1,
          ownerAddress: attackerAddress,
          signature: attackerSig,
        },
      });

      expect(spoofAttempt.status).toBe(401);
      expect(spoofAttempt.body.error).toContain("Invalid cryptographic signature proof from payTo address");
    });

    it("should guarantee zero payment settlement and invoke automated escrow refund on tool failure", async () => {
      // Register failing tool
      executor.registerHandler("flaky-calc", async () => {
        return {
          content: [{ type: "text", text: "Internal computational failure" }],
          isError: true,
          errorCode: "TOOL_INTERNAL_ERROR",
        };
      });

      registry.registerLocalTool({
        name: "flaky-calc",
        description: "Failing calculator",
        inputSchema: {},
        pricing: {
          microUsdc: "5000",
          usdFormatted: "$0.0050",
          token: "USDC-c76f1f",
          serviceId: 1,
          providerAgentNonce: 1,
        },
        payTo: validPayTo,
      });

      const mockRefundFn = vi.fn().mockResolvedValue("refund-tx-12345");
      const escrowAdapter = new McpEscrowAdapter({
        refundFn: mockRefundFn,
      });

      const mockSettlementQueue = {
        settle: vi.fn(),
      };

      const failingGateway = new McpGateway({
        registry,
        executor,
        merchantPool,
        verifier,
        escrowAdapter,
        settlementQueue: mockSettlementQueue as any,
      });

      const dummySig = Buffer.from(
        JSON.stringify({
          x402Version: 2,
          network: "multiversx:1",
          scheme: "exact",
          payload: {
            nonce: 1,
            value: "0",
            receiver: validPayTo,
            sender: verifier.payerAddress,
            gasPrice: 1000000000,
            gasLimit: 50000000,
            chainID: "1",
            version: 1,
            signature: "mock-sig",
          },
        })
      ).toString("base64");

      const res = await request(failingGateway.app)
        .post("/mcp/v1/tools/call")
        .set("payment-signature", dummySig)
        .send({
          jsonrpc: "2.0",
          id: 42,
          method: "tools/call",
          params: {
            name: "flaky-calc",
            arguments: {},
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.result.isError).toBe(true);
      expect(res.body.settled).toBe(false);
      expect(res.body.refunded).toBe(true);
      expect(res.body.refundTransaction).toBe("refund-tx-12345");
      expect(res.headers["x-payment-settled"]).toBe("false");
      expect(res.headers["x-payment-refunded"]).toBe("true");

      // Verify zero settlement occurred
      expect(mockSettlementQueue.settle).not.toHaveBeenCalled();
      // Verify refund was invoked
      expect(mockRefundFn).toHaveBeenCalledTimes(1);
    });
  });
});
