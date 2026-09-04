import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import http from "http";
import { Address } from "@multiversx/sdk-core";
import {
  ToolCircuitBreaker,
  ToolCircuitOpenError,
  ToolUpstreamTimeoutError,
} from "../../src/gateway/tool_circuit_breaker.js";
import { McpGateway } from "../../src/gateway/mcp_gateway.js";
import { McpRegistryAdapter } from "../../src/services/mcp_registry_adapter.js";
import { McpExecutor } from "../../src/services/mcp_executor.js";
import { MerchantPoolManager } from "../../src/services/merchant_pool.js";
import { IVerifierService } from "../../src/services/verifier.js";

describe("ToolCircuitBreaker & Timeout Guard (TDD)", () => {
  describe("Unit: ToolCircuitBreaker", () => {
    it("should allow calls when circuit is CLOSED and reset failure count on success", async () => {
      const breaker = new ToolCircuitBreaker({ failureThreshold: 3, timeoutMs: 1000 });
      expect(breaker.getState("test_tool")).toBe("CLOSED");
      expect(breaker.canExecute("test_tool")).toBe(true);

      const action = vi.fn().mockResolvedValue({ success: true });
      const res = await breaker.execute("test_tool", action);

      expect(res).toEqual({ success: true });
      expect(action).toHaveBeenCalledTimes(1);
      expect(breaker.getState("test_tool")).toBe("CLOSED");
    });

    it("should trip circuit to OPEN after consecutive failures reach threshold", async () => {
      const breaker = new ToolCircuitBreaker({ failureThreshold: 2, cooldownMs: 500, timeoutMs: 1000 });
      const failingAction = vi.fn().mockRejectedValue(new Error("Upstream connection refused"));

      // 1st failure
      await expect(breaker.execute("failing_tool", failingAction)).rejects.toThrow("Upstream connection refused");
      expect(breaker.getState("failing_tool")).toBe("CLOSED");

      // 2nd failure -> reaches threshold 2 -> trips to OPEN
      await expect(breaker.execute("failing_tool", failingAction)).rejects.toThrow("Upstream connection refused");
      expect(breaker.getState("failing_tool")).toBe("OPEN");

      // 3rd attempt -> fails fast without calling action
      await expect(breaker.execute("failing_tool", failingAction)).rejects.toThrow(ToolCircuitOpenError);
      expect(failingAction).toHaveBeenCalledTimes(2); // Was NOT called a 3rd time
    });

    it("should abort action and throw ToolUpstreamTimeoutError when action times out", async () => {
      const breaker = new ToolCircuitBreaker({ timeoutMs: 50 });
      const slowAction = async (signal: AbortSignal) => {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve("done"), 500);
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("aborted"));
          });
        });
      };

      await expect(breaker.execute("slow_tool", slowAction)).rejects.toThrow(ToolUpstreamTimeoutError);
    });

    it("should transition to HALF_OPEN after cooldown and recover to CLOSED on success", async () => {
      const breaker = new ToolCircuitBreaker({ failureThreshold: 1, cooldownMs: 60 });
      const failingAction = vi.fn().mockRejectedValue(new Error("fail"));

      // Trip circuit
      await expect(breaker.execute("recovery_tool", failingAction)).rejects.toThrow("fail");
      expect(breaker.getState("recovery_tool")).toBe("OPEN");

      // Wait for cooldown
      await new Promise((r) => setTimeout(r, 80));

      expect(breaker.getState("recovery_tool")).toBe("HALF_OPEN");
      expect(breaker.canExecute("recovery_tool")).toBe(true);

      // Successful recovery execution
      const successAction = vi.fn().mockResolvedValue({ recovered: true });
      const res = await breaker.execute("recovery_tool", successAction);
      expect(res).toEqual({ recovered: true });
      expect(breaker.getState("recovery_tool")).toBe("CLOSED");
    });
  });

  describe("Integration: McpGateway Circuit Breaker & Timeout Guard", () => {
    let server: http.Server | null = null;
    let upstreamPort: number;
    let upstreamServer: http.Server;
    let upstreamHandler: (req: http.IncomingMessage, res: http.ServerResponse) => void;

    let gateway: McpGateway;
    let registry: McpRegistryAdapter;
    let executor: McpExecutor;
    let circuitBreaker: ToolCircuitBreaker;

    beforeEach(async () => {
      // Start mock upstream server
      await new Promise<void>((resolve) => {
        upstreamServer = http.createServer((req, res) => {
          upstreamHandler(req, res);
        });
        upstreamServer.listen(0, () => {
          const addr = upstreamServer.address() as any;
          upstreamPort = addr.port;
          resolve();
        });
      });

      registry = new McpRegistryAdapter({ dbPathOrDb: ":memory:" });
      executor = new McpExecutor({ timeoutMs: 5000 });
      circuitBreaker = new ToolCircuitBreaker({
        failureThreshold: 2,
        cooldownMs: 200,
        timeoutMs: 150, // fast timeout for test
      });

      const mockVerifier: IVerifierService = {
        verify: vi.fn().mockResolvedValue({ valid: true }),
      } as any;

      gateway = new McpGateway({
        registry,
        executor,
        merchantPool: new MerchantPoolManager(),
        verifier: mockVerifier,
        circuitBreaker,
        network: "multiversx:D",
      });
    });

    afterEach(async () => {
      if (upstreamServer) {
        upstreamServer.closeAllConnections?.();
        await new Promise<void>((resolve) => upstreamServer.close(() => resolve()));
      }
      if (server) {
        server.closeAllConnections?.();
        await new Promise<void>((resolve) => server!.close(() => resolve()));
      }
      registry.close();
    });

    it("should return TOOL_UPSTREAM_TIMEOUT error code when external tool times out", async () => {
      // Handler that hangs longer than timeoutMs (150ms)
      upstreamHandler = (_req, res) => {
        setTimeout(() => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ content: [{ type: "text", text: "too late" }] }));
        }, 500);
      };

      // Register tool with upstream URL
      const handler = gateway.createExternalToolHandler(
        "slow_external_tool",
        `http://127.0.0.1:${upstreamPort}/mcp`
      );

      const result = await handler({ city: "Sibiu" });

      expect(result.isError).toBe(true);
      expect(result.errorCode).toBe("TOOL_UPSTREAM_TIMEOUT");
      expect(result.content[0].text).toContain("timed out");
    });

    it("should return TOOL_CIRCUIT_OPEN when consecutive upstream failures trip circuit", async () => {
      // Upstream returns 500 Internal Error
      upstreamHandler = (_req, res) => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Server crashing" }));
      };

      const handler = gateway.createExternalToolHandler(
        "flaky_external_tool",
        `http://127.0.0.1:${upstreamPort}/mcp`
      );

      // Call 1 -> failure 1
      const res1 = await handler({ query: "1" });
      expect(res1.isError).toBe(true);
      expect(circuitBreaker.getState("flaky_external_tool")).toBe("CLOSED");

      // Call 2 -> failure 2 -> trips circuit to OPEN
      const res2 = await handler({ query: "2" });
      expect(res2.isError).toBe(true);
      expect(circuitBreaker.getState("flaky_external_tool")).toBe("OPEN");

      // Call 3 -> circuit is OPEN -> fast fail with TOOL_CIRCUIT_OPEN
      const res3 = await handler({ query: "3" });
      expect(res3.isError).toBe(true);
      expect(res3.errorCode).toBe("TOOL_CIRCUIT_OPEN");
      expect(res3.content[0].text).toContain("circuit breaker is OPEN");
    });

    it("should succeed and return tool output when upstream responds cleanly", async () => {
      upstreamHandler = (req, res) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          const parsed = JSON.parse(body);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              content: [{ type: "text", text: `Processed args for ${parsed.name}` }],
              isError: false,
            })
          );
        });
      };

      const handler = gateway.createExternalToolHandler(
        "healthy_tool",
        `http://127.0.0.1:${upstreamPort}/mcp`
      );

      const result = await handler({ city: "Cluj-Napoca" });
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe("Processed args for healthy_tool");
      expect(circuitBreaker.getState("healthy_tool")).toBe("CLOSED");
    });
  });
});
