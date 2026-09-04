import { ArbitrageMatrix } from "./arbitrage_matrix.js";
import { ModelResolution } from "./types.js";

const MODEL_ALIASES: Record<string, string> = {
  "auto:reasoning": "deepseek-r1-distill-llama-70b",
  "auto:deepseek-r1": "deepseek-r1-distill-llama-70b",
  "auto:fast": "llama-3.3-70b",
  "auto:code": "qwen-2.5-coder-32b",
  "auto:chat": "llama-3.3-70b",
};

export class ModelMapper {
  private matrix: ArbitrageMatrix;

  constructor(matrix: ArbitrageMatrix) {
    this.matrix = matrix;
  }

  public resolveModel(
    requestedModel: string,
    strategy: "cost-optimized" | "latency-optimized" | "balanced" = "cost-optimized"
  ): ModelResolution {
    const resolvedModel = MODEL_ALIASES[requestedModel] || requestedModel;

    let ranked = this.matrix.getRankedProviders(resolvedModel, strategy);
    if (ranked.length === 0) {
      // If no providers for exact resolved model, check all providers
      ranked = this.matrix.getAllProviders().filter((p) => p.healthy);
    }

    const provider = ranked[0] || {
      id: "default-spot-node",
      costPerMillionInputTokensUsd: 0.5,
      costPerMillionOutputTokensUsd: 0.8,
    };

    // Standard estimate based on 1,000 prompt tokens + 500 output tokens
    const estimatedCostUsd =
      (1000 * provider.costPerMillionInputTokensUsd +
        500 * provider.costPerMillionOutputTokensUsd) /
      1_000_000;

    // Convert to micro-USDC (minimum 1,000 micro-USDC flat fee)
    const microUsdc = Math.max(1000, Math.round(estimatedCostUsd * 1_000_000)).toString();

    return {
      alias: requestedModel,
      resolvedModel,
      providerId: provider.id,
      estimatedCostUsd,
      estimatedMicroUsdc: microUsdc,
    };
  }
}
