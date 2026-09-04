import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { McpGateway } from "../../src/gateway/mcp_gateway.js";
import { McpRegistryAdapter } from "../../src/services/mcp_registry_adapter.js";
import { McpExecutor } from "../../src/services/mcp_executor.js";
import { MerchantPoolManager } from "../../src/services/merchant_pool.js";
import { IVerifierService } from "../../src/services/verifier.js";
import { McpProofLogger } from "../../src/services/mcp_proof_logger.js";
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
  let mockLogProof: any;
  let mockGiveFeedback: any;

  beforeEach(() => {
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
  });

  describe("GET /mcp/v1/tools", () => {
    it("should return the list of available tools with pricing", async () => {
      const res = await request(gateway.app).get("/mcp/v1/tools");
      expect(res.status).toBe(200);
      expect(res.body.tools).toBeInstanceOf(Array);
      expect(res.body.tools.length).toBe(1);
      expect(res.body.tools[0].name).toBe("multiversx-analyzer");
      expect(res.body.tools[0].pricing.microUsdc).toBe("5000");
    });
  });

  describe("POST /mcp/v1/tools/call without payment", () => {
    it("should return HTTP 402 Payment Required challenge with standard x402 headers", async () => {
      const res = await request(gateway.app)
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
      const res = await request(gateway.app)
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

      const res = await request(gateway.app)
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

      const res = await request(gateway.app)
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
      const res = await request(gateway.app)
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

      const res = await request(gateway.app)
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

      const res = await request(gateway.app)
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
      const res = await request(gateway.app)
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
      const res = await request(gateway.app)
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
});
