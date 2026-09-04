import crypto from "crypto";
import { ReputationClient } from "../services/reputation_client.js";

export interface AbuseReporterOptions {
  reputationClient?: ReputationClient;
  failureThreshold?: number;
  windowMs?: number;
}

interface FailureEntry {
  count: number;
  firstFailureTime: number;
}

export class AbuseReporter {
  private reputationClient: ReputationClient;
  private failureThreshold: number;
  private windowMs: number;
  private failures = new Map<string, FailureEntry>();

  constructor(options: AbuseReporterOptions = {}) {
    this.reputationClient = options.reputationClient ?? new ReputationClient();
    this.failureThreshold = options.failureThreshold ?? 5;
    this.windowMs = options.windowMs ?? 60_000;
  }

  public async recordFailure(
    ip: string,
    agentNonce?: number
  ): Promise<string | undefined> {
    const key = agentNonce !== undefined ? `agent:${agentNonce}` : `ip:${ip}`;
    const now = Date.now();

    const entry = this.failures.get(key);
    if (!entry || now - entry.firstFailureTime > this.windowMs) {
      this.failures.set(key, { count: 1, firstFailureTime: now });
      return undefined;
    }

    entry.count++;

    if (entry.count >= this.failureThreshold) {
      // Reset counter to prevent repeated spamming
      this.failures.delete(key);

      if (agentNonce !== undefined) {
        const feedbackUri = `tollbooth://abuse/${ip}/${Date.now()}`;
        const feedbackHash = crypto.createHash("sha256").update(feedbackUri).digest("hex");

        return await this.reputationClient.giveFeedback(
          agentNonce,
          -100,
          2,
          "abuse/dos",
          "invalid_signature_flood",
          "/tollbooth",
          feedbackUri,
          feedbackHash
        );
      }
    }

    return undefined;
  }

  public getFailureCount(key: string): number {
    const entry = this.failures.get(key);
    if (!entry) return 0;
    if (Date.now() - entry.firstFailureTime > this.windowMs) {
      this.failures.delete(key);
      return 0;
    }
    return entry.count;
  }
}
