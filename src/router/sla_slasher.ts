import { ArbitrageMatrix } from "./arbitrage_matrix.js";

export type ValidationResponseFn = (
  requestHash: string,
  score: number,
  tag: string
) => Promise<string>;

export interface SlaSlasherOptions {
  matrix: ArbitrageMatrix;
  maxAllowedTtftMs?: number;
  consecutiveFailureLimit?: number;
  validationResponseFn?: ValidationResponseFn;
}

export class SlaSlasher {
  private matrix: ArbitrageMatrix;
  private maxAllowedTtftMs: number;
  private consecutiveFailureLimit: number;
  private validationResponseFn?: ValidationResponseFn;
  private failureCounts = new Map<string, number>();

  constructor(options: SlaSlasherOptions) {
    this.matrix = options.matrix;
    this.maxAllowedTtftMs = options.maxAllowedTtftMs ?? 1500;
    this.consecutiveFailureLimit = options.consecutiveFailureLimit ?? 3;
    this.validationResponseFn = options.validationResponseFn;
  }

  public async reportTtft(
    providerId: string,
    ttftMs: number,
    requestHash: string
  ): Promise<string | undefined> {
    if (ttftMs > this.maxAllowedTtftMs) {
      this.matrix.updateHealth(providerId, false, ttftMs);

      if (this.validationResponseFn) {
        return await this.validationResponseFn(requestHash, 0, "SLA_BREACH");
      }
      return `mock-slash-${Date.now()}`;
    }

    this.matrix.updateHealth(providerId, true, ttftMs);
    return undefined;
  }

  public async reportFailure(
    providerId: string,
    requestHash: string
  ): Promise<string | undefined> {
    const current = (this.failureCounts.get(providerId) ?? 0) + 1;
    this.failureCounts.set(providerId, current);

    if (current >= this.consecutiveFailureLimit) {
      this.matrix.updateHealth(providerId, false);
      this.failureCounts.delete(providerId);

      if (this.validationResponseFn) {
        return await this.validationResponseFn(requestHash, 0, "SLA_BREACH");
      }
      return `mock-slash-${Date.now()}`;
    }

    return undefined;
  }
}
