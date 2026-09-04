import { ArbitrageMatrix } from "./arbitrage_matrix.js";
import { ReputationClient } from "../services/reputation_client.js";

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
  reputationClient?: ReputationClient;
  providerAgentNonceMap?: Map<string, number> | Record<string, number>;
}

export class SlaSlasher {
  private matrix: ArbitrageMatrix;
  private maxAllowedTtftMs: number;
  private consecutiveFailureLimit: number;
  private validationResponseFn?: ValidationResponseFn;
  private reputationClient?: ReputationClient;
  private providerAgentNonceMap = new Map<string, number>();
  private failureCounts = new Map<string, number>();

  constructor(options: SlaSlasherOptions) {
    this.matrix = options.matrix;
    this.maxAllowedTtftMs = options.maxAllowedTtftMs ?? 1500;
    this.consecutiveFailureLimit = options.consecutiveFailureLimit ?? 3;
    this.validationResponseFn = options.validationResponseFn;
    this.reputationClient = options.reputationClient;
    if (options.providerAgentNonceMap) {
      if (options.providerAgentNonceMap instanceof Map) {
        this.providerAgentNonceMap = options.providerAgentNonceMap;
      } else {
        for (const [k, v] of Object.entries(options.providerAgentNonceMap)) {
          this.providerAgentNonceMap.set(k, v);
        }
      }
    }
  }

  private async executeSlash(providerId: string, requestHash: string): Promise<string> {
    let slashResult: string | undefined;

    // 1. Slash on-chain via ValidationRegistry if callback provided
    if (this.validationResponseFn) {
      slashResult = await this.validationResponseFn(requestHash, 0, "SLA_BREACH");
    }

    // 2. Slash on-chain via Devnet ReputationRegistry feedback
    if (this.reputationClient) {
      const agentNonce = this.providerAgentNonceMap.get(providerId);
      if (agentNonce !== undefined) {
        const feedbackTx = await this.reputationClient.giveFeedbackSimple(
          requestHash,
          agentNonce,
          1 // Lowest possible rating (1/100) indicating critical SLA failure
        );
        if (!slashResult) {
          slashResult = feedbackTx;
        }
      }
    }

    return slashResult ?? `mock-slash-${Date.now()}`;
  }

  public async reportTtft(
    providerId: string,
    ttftMs: number,
    requestHash: string
  ): Promise<string | undefined> {
    if (ttftMs > this.maxAllowedTtftMs) {
      this.matrix.updateHealth(providerId, false, ttftMs);
      return await this.executeSlash(providerId, requestHash);
    }

    // Reset consecutive failure count on healthy response within SLA limit
    this.failureCounts.delete(providerId);
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
      return await this.executeSlash(providerId, requestHash);
    }

    return undefined;
  }
}

