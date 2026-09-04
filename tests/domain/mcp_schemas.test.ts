import { describe, it, expect } from "vitest";
import {
  McpRpcRequestSchema,
  McpToolDefinitionSchema,
  McpToolCallResultSchema,
  McpResourceReadResultSchema,
  McpPricingConfigSchema,
} from "../../src/domain/mcp_types.js";

describe("MCP Gateway Domain Schemas & Types (TDD)", () => {
  describe("McpRpcRequestSchema", () => {
    it("should accept valid tools/call request", () => {
      const valid = {
        jsonrpc: "2.0",
        id: "req-101",
        method: "tools/call",
        params: {
          name: "multiversx-analyzer",
          arguments: {
            address: "erd1qqqqqqqqqqqqqpgqak8zt22wl2ph4622up82t098pknqq6cvjcqq8p5w8s",
          },
        },
      };
      const parsed = McpRpcRequestSchema.parse(valid);
      expect(parsed.method).toBe("tools/call");
      expect(parsed.params?.name).toBe("multiversx-analyzer");
    });

    it("should accept valid resources/read request", () => {
      const valid = {
        jsonrpc: "2.0",
        id: 42,
        method: "resources/read",
        params: {
          uri: "multiversx://contracts/erd1qqqqqqqqqqqqqpgqak8zt22wl2ph4622up82t098pknqq6cvjcqq8p5w8s/abi",
        },
      };
      const parsed = McpRpcRequestSchema.parse(valid);
      expect(parsed.method).toBe("resources/read");
      expect(parsed.params?.uri).toContain("abi");
    });

    it("should accept valid tools/list request", () => {
      const valid = {
        jsonrpc: "2.0",
        id: "list-1",
        method: "tools/list",
      };
      const parsed = McpRpcRequestSchema.parse(valid);
      expect(parsed.method).toBe("tools/list");
    });

    it("should reject request with unsupported jsonrpc version", () => {
      const invalid = {
        jsonrpc: "1.0",
        id: 1,
        method: "tools/call",
      };
      expect(() => McpRpcRequestSchema.parse(invalid)).toThrow();
    });

    it("should reject request with unsupported method", () => {
      const invalid = {
        jsonrpc: "2.0",
        id: 1,
        method: "invalid/method",
      };
      expect(() => McpRpcRequestSchema.parse(invalid)).toThrow();
    });
  });

  describe("McpToolDefinitionSchema", () => {
    it("should validate a full tool definition with pricing and mx-8004 metadata", () => {
      const tool = {
        name: "multiversx-analyzer",
        description: "Deep bytecode security analyzer",
        inputSchema: {
          type: "object",
          properties: { address: { type: "string" } },
          required: ["address"],
        },
        pricing: {
          microUsdc: "5000",
          usdFormatted: "$0.005000",
          token: "USDC-c76f1f",
          serviceId: 101,
          providerAgentNonce: 42,
        },
        reputationScore: 98.4,
        totalCompletedJobs: 1420,
      };
      const parsed = McpToolDefinitionSchema.parse(tool);
      expect(parsed.name).toBe("multiversx-analyzer");
      expect(parsed.pricing.serviceId).toBe(101);
      expect(parsed.pricing.microUsdc).toBe("5000");
    });

    it("should reject tool definition if serviceId is not a positive integer", () => {
      const invalid = {
        name: "bad-tool",
        description: "Bad",
        inputSchema: {},
        pricing: {
          microUsdc: "5000",
          usdFormatted: "$0.005000",
          token: "USDC-c76f1f",
          serviceId: -5,
          providerAgentNonce: 1,
        },
      };
      expect(() => McpToolDefinitionSchema.parse(invalid)).toThrow();
    });
  });

  describe("McpToolCallResultSchema", () => {
    it("should validate standard tool output", () => {
      const result = {
        content: [
          {
            type: "text",
            text: "No reentrancy vulnerability detected.",
          },
        ],
        isError: false,
        paymentReceipt: "a4f8b939d882f099182310239103912039120931203910293102930129301293",
      };
      const parsed = McpToolCallResultSchema.parse(result);
      expect(parsed.isError).toBe(false);
      expect(parsed.content[0].text).toContain("reentrancy");
    });
  });
});
