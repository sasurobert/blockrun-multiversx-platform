import crypto from "crypto";

export interface EscrowDepositParams {
  jobId: string;
  receiver: string;
  poaHash?: string;
  deadlineSeconds: number;
  token: string;
  amount: string;
}

export interface EscrowDepositResult {
  txHash: string;
  jobId: string;
  deadline: number;
}

export interface EscrowReleaseResult {
  txHash: string;
  jobId: string;
  status: "released";
}

export interface EscrowRefundResult {
  txHash: string;
  jobId: string;
  status: "refunded";
}

export type DepositFn = (params: EscrowDepositParams) => Promise<string>;
export type ReleaseFn = (jobId: string) => Promise<string>;
export type RefundFn = (jobId: string) => Promise<string>;

export interface McpEscrowAdapterOptions {
  escrowContractAddress?: string;
  depositFn?: DepositFn;
  releaseFn?: ReleaseFn;
  refundFn?: RefundFn;
}

export class McpEscrowAdapter {
  private escrowContractAddress?: string;
  private depositFn?: DepositFn;
  private releaseFn?: ReleaseFn;
  private refundFn?: RefundFn;

  constructor(options: McpEscrowAdapterOptions = {}) {
    this.escrowContractAddress = options.escrowContractAddress;
    this.depositFn = options.depositFn;
    this.releaseFn = options.releaseFn;
    this.refundFn = options.refundFn;
  }

  public async deposit(params: EscrowDepositParams): Promise<EscrowDepositResult> {
    const poaHash =
      params.poaHash ??
      crypto.createHash("sha256").update(`${params.jobId}:${params.receiver}:${params.amount}`).digest("hex");

    let txHash = `mock-escrow-deposit-${Date.now()}`;
    if (this.depositFn) {
      txHash = await this.depositFn({ ...params, poaHash });
    }

    return {
      txHash,
      jobId: params.jobId,
      deadline: params.deadlineSeconds,
    };
  }

  public async release(jobId: string): Promise<EscrowReleaseResult> {
    let txHash = `mock-escrow-release-${Date.now()}`;
    if (this.releaseFn) {
      txHash = await this.releaseFn(jobId);
    }

    return {
      txHash,
      jobId,
      status: "released",
    };
  }

  public async refund(jobId: string): Promise<EscrowRefundResult> {
    let txHash = `mock-escrow-refund-${Date.now()}`;
    if (this.refundFn) {
      txHash = await this.refundFn(jobId);
    }

    return {
      txHash,
      jobId,
      status: "refunded",
    };
  }
}
