import { describe, it, expect, vi } from "vitest";
import { McpProofLogger } from "../../src/services/mcp_proof_logger.js";

describe("McpProofLogger (TDD)", () => {
  it("should initialize job and submit SHA-256 proof to ValidationRegistry", async () => {
    const mockInitJob = vi.fn().mockResolvedValue("tx-init-hash-1");
    const mockSubmitProof = vi.fn().mockResolvedValue("tx-proof-hash-2");

    const logger = new McpProofLogger({
      validationContractAddress: "erd1qqqqqqqqqqqqqpgqak8zt22wl2ph4622up82t098pknqq6cvjcqq8p5w8s",
      initJobFn: mockInitJob,
      submitProofFn: mockSubmitProof,
    });

    const receipt = await logger.logProof({
      jobId: "job-101",
      agentNonce: 42,
      serviceId: 101,
      toolName: "multiversx-analyzer",
      args: { address: "erd1test" },
      result: { content: [{ type: "text", text: "safe" }] },
    });

    expect(receipt.txHashInit).toBe("tx-init-hash-1");
    expect(receipt.txHashProof).toBe("tx-proof-hash-2");
    expect(receipt.proofDigest).toHaveLength(64); // 32-byte sha256 hex
    expect(mockInitJob).toHaveBeenCalledWith("job-101", 42, 101);
    expect(mockSubmitProof).toHaveBeenCalledWith("job-101", receipt.proofDigest);
  });

  it("should fail gracefully if init_job fails", async () => {
    const mockInitJob = vi.fn().mockRejectedValue(new Error("Network timeout"));
    const mockSubmitProof = vi.fn();

    const logger = new McpProofLogger({
      initJobFn: mockInitJob,
      submitProofFn: mockSubmitProof,
    });

    await expect(
      logger.logProof({
        jobId: "job-fail",
        agentNonce: 42,
        serviceId: 101,
        toolName: "test",
        args: {},
        result: {},
      })
    ).rejects.toThrow("Network timeout");

    expect(mockSubmitProof).not.toHaveBeenCalled();
  });
});
