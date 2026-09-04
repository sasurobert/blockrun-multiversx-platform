import crypto from "crypto";

export interface LogProofParams {
  jobId: string;
  agentNonce: number;
  serviceId: number;
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
}

export interface LogProofResult {
  txHashInit: string;
  txHashProof: string;
  proofDigest: string;
}

export type InitJobFn = (
  jobId: string,
  agentNonce: number,
  serviceId: number
) => Promise<string>;

export type SubmitProofFn = (
  jobId: string,
  proofDigest: string
) => Promise<string>;

export interface McpProofLoggerOptions {
  validationContractAddress?: string;
  initJobFn?: InitJobFn;
  submitProofFn?: SubmitProofFn;
}

export class McpProofLogger {
  private validationContractAddress?: string;
  private initJobFn?: InitJobFn;
  private submitProofFn?: SubmitProofFn;

  constructor(options: McpProofLoggerOptions = {}) {
    this.validationContractAddress = options.validationContractAddress;
    this.initJobFn = options.initJobFn;
    this.submitProofFn = options.submitProofFn;
  }

  public computeProofDigest(toolName: string, args: unknown, result: unknown): string {
    const payload = JSON.stringify({ toolName, args, result });
    return crypto.createHash("sha256").update(payload).digest("hex");
  }

  public async logProof(params: LogProofParams): Promise<LogProofResult> {
    const proofDigest = this.computeProofDigest(params.toolName, params.args, params.result);

    let txHashInit = `mock-init-${Date.now()}`;
    let txHashProof = `mock-proof-${Date.now()}`;

    if (this.initJobFn) {
      txHashInit = await this.initJobFn(params.jobId, params.agentNonce, params.serviceId);
    }

    if (this.submitProofFn) {
      txHashProof = await this.submitProofFn(params.jobId, proofDigest);
    }

    return {
      txHashInit,
      txHashProof,
      proofDigest,
    };
  }
}
