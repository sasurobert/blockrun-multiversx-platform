export type GiveFeedbackSimpleFn = (
  jobId: string,
  agentNonce: number,
  rating: number
) => Promise<string>;

export type GiveFeedbackFn = (
  agentNonce: number,
  value: number,
  decimals: number,
  tag1: string,
  tag2: string,
  endpoint: string,
  feedbackUri: string,
  feedbackHash: string
) => Promise<string>;

export type GetScoreFn = (agentNonce: number) => Promise<number>;

export interface ReputationClientOptions {
  reputationContractAddress?: string;
  giveFeedbackSimpleFn?: GiveFeedbackSimpleFn;
  giveFeedbackFn?: GiveFeedbackFn;
  getScoreFn?: GetScoreFn;
}

export class ReputationClient {
  private reputationContractAddress?: string;
  private giveFeedbackSimpleFn?: GiveFeedbackSimpleFn;
  private giveFeedbackFn?: GiveFeedbackFn;
  private getScoreFn?: GetScoreFn;

  constructor(options: ReputationClientOptions = {}) {
    this.reputationContractAddress = options.reputationContractAddress;
    this.giveFeedbackSimpleFn = options.giveFeedbackSimpleFn;
    this.giveFeedbackFn = options.giveFeedbackFn;
    this.getScoreFn = options.getScoreFn;
  }

  public async giveFeedbackSimple(
    jobId: string,
    agentNonce: number,
    rating: number
  ): Promise<string> {
    if (rating < 1 || rating > 100) {
      throw new Error("Rating must be between 1 and 100");
    }

    if (this.giveFeedbackSimpleFn) {
      return await this.giveFeedbackSimpleFn(jobId, agentNonce, rating);
    }

    return `mock-feedback-${Date.now()}`;
  }

  public async giveFeedback(
    agentNonce: number,
    value: number,
    decimals: number,
    tag1: string,
    tag2: string,
    endpoint: string,
    feedbackUri: string,
    feedbackHash: string
  ): Promise<string> {
    if (this.giveFeedbackFn) {
      return await this.giveFeedbackFn(
        agentNonce,
        value,
        decimals,
        tag1,
        tag2,
        endpoint,
        feedbackUri,
        feedbackHash
      );
    }

    return `mock-erc8004-feedback-${Date.now()}`;
  }

  public async getReputationScore(agentNonce: number): Promise<number> {
    if (this.getScoreFn) {
      return await this.getScoreFn(agentNonce);
    }
    return 100.0;
  }
}
