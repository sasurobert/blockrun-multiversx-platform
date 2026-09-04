import { describe, it, expect } from "vitest";
import { McpExecutor } from "../../src/services/mcp_executor.js";

describe("McpExecutor (TDD)", () => {
  it("should execute registered local handler successfully", async () => {
    const executor = new McpExecutor();
    executor.registerHandler("multiversx-analyzer", async (args) => {
      return {
        content: [
          {
            type: "text",
            text: `Analysis for ${args.address}: Valid contract.`,
          },
        ],
        isError: false,
      };
    });

    const result = await executor.executeTool("multiversx-analyzer", {
      address: "erd1test",
    });

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("Valid contract");
  });

  it("should handle handler timeout gracefully", async () => {
    const executor = new McpExecutor({ timeoutMs: 50 });
    executor.registerHandler("slow-tool", async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return { content: [{ type: "text", text: "done" }], isError: false };
    });

    const result = await executor.executeTool("slow-tool", {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("timed out");
  });

  it("should return error when tool is not registered", async () => {
    const executor = new McpExecutor();
    const result = await executor.executeTool("unknown-tool", {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not found");
  });
});
