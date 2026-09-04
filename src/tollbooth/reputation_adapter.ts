import { ReputationClient } from "../services/reputation_client.js";

export interface TollboothReputationAdapterOptions {
  reputationClient?: ReputationClient;
}

export class TollboothReputationAdapter {
  private reputationClient: ReputationClient;

  constructor(options: TollboothReputationAdapterOptions = {}) {
    this.reputationClient = options.reputationClient ?? new ReputationClient();
  }

  public async getAgentScore(agentNonce?: number): Promise<number | undefined> {
    if (agentNonce === undefined || isNaN(agentNonce)) {
      return undefined;
    }
    return await this.reputationClient.getReputationScore(agentNonce);
  }

  public getTier(score?: number): "vip" | "standard" | "probe" {
    if (score === undefined) return "probe";
    if (score >= 90) return "vip";
    if (score >= 50) return "standard";
    return "probe";
  }
}
