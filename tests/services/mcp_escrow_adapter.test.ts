import { describe, it, expect, vi } from "vitest";
import { McpEscrowAdapter } from "../../src/services/mcp_escrow_adapter.js";

describe("McpEscrowAdapter (TDD)", () => {
  it("should deposit funds into escrow with computed poaHash", async () => {
    const mockDepositFn = vi.fn().mockResolvedValue("tx-escrow-dep-123");

    const adapter = new McpEscrowAdapter({
      depositFn: mockDepositFn,
    });

    const result = await adapter.deposit({
      jobId: "job-escrow-42",
      receiver: "erd1ka0yrspygvjtktyzxu58ufn0kujkqgx4gq2ch5ev2aqjcem9jcqqkntrmv",
      token: "USDC-c76f1f",
      amount: "1000000",
      deadlineSeconds: 1726000000,
    });

    expect(result.jobId).toBe("job-escrow-42");
    expect(result.txHash).toBe("tx-escrow-dep-123");
    expect(result.deadline).toBe(1726000000);
    expect(mockDepositFn).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-escrow-42",
        poaHash: expect.any(String),
      })
    );
  });

  it("should release escrowed funds to receiver", async () => {
    const mockReleaseFn = vi.fn().mockResolvedValue("tx-escrow-rel-456");

    const adapter = new McpEscrowAdapter({
      releaseFn: mockReleaseFn,
    });

    const result = await adapter.release("job-escrow-42");
    expect(result.jobId).toBe("job-escrow-42");
    expect(result.status).toBe("released");
    expect(result.txHash).toBe("tx-escrow-rel-456");
    expect(mockReleaseFn).toHaveBeenCalledWith("job-escrow-42");
  });

  it("should refund escrowed funds to employer after deadline", async () => {
    const mockRefundFn = vi.fn().mockResolvedValue("tx-escrow-ref-789");

    const adapter = new McpEscrowAdapter({
      refundFn: mockRefundFn,
    });

    const result = await adapter.refund("job-escrow-42");
    expect(result.jobId).toBe("job-escrow-42");
    expect(result.status).toBe("refunded");
    expect(result.txHash).toBe("tx-escrow-ref-789");
    expect(mockRefundFn).toHaveBeenCalledWith("job-escrow-42");
  });
});
