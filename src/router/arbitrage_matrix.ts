import { ProviderSpec } from "./types.js";

export class ArbitrageMatrix {
  private providers = new Map<string, ProviderSpec>();

  public registerProvider(spec: ProviderSpec): void {
    this.providers.set(spec.id, spec);
  }

  public getProvider(id: string): ProviderSpec | undefined {
    return this.providers.get(id);
  }

  public getAllProviders(): ProviderSpec[] {
    return Array.from(this.providers.values());
  }

  public updateHealth(id: string, healthy: boolean, ttftMs?: number): void {
    const provider = this.providers.get(id);
    if (provider) {
      provider.healthy = healthy;
      if (ttftMs !== undefined) {
        // Exponential moving average
        provider.avgTtftMs = Math.round(provider.avgTtftMs * 0.7 + ttftMs * 0.3);
      }
    }
  }

  public updateSpotPricing(
    id: string,
    pricing: {
      costPerMillionInputTokensUsd?: number;
      costPerMillionOutputTokensUsd?: number;
      tokensPerSecond?: number;
    }
  ): boolean {
    const provider = this.providers.get(id);
    if (!provider) {
      return false;
    }
    if (typeof pricing.costPerMillionInputTokensUsd === "number") {
      provider.costPerMillionInputTokensUsd = pricing.costPerMillionInputTokensUsd;
    }
    if (typeof pricing.costPerMillionOutputTokensUsd === "number") {
      provider.costPerMillionOutputTokensUsd = pricing.costPerMillionOutputTokensUsd;
    }
    if (typeof pricing.tokensPerSecond === "number") {
      provider.tokensPerSecond = pricing.tokensPerSecond;
    }
    return true;
  }

  public ingestSpotPricingFeed(
    updates: Array<{
      id: string;
      costPerMillionInputTokensUsd?: number;
      costPerMillionOutputTokensUsd?: number;
      tokensPerSecond?: number;
    }>
  ): { updatedCount: number; errors: string[] } {
    let updatedCount = 0;
    const errors: string[] = [];

    for (const update of updates) {
      if (!update || !update.id) {
        errors.push("Missing provider id in pricing update entry");
        continue;
      }
      const success = this.updateSpotPricing(update.id, update);
      if (success) {
        updatedCount++;
      } else {
        errors.push(`Provider not found: ${update.id}`);
      }
    }

    return { updatedCount, errors };
  }

  public getRankedProviders(
    model: string,
    strategy: "cost-optimized" | "latency-optimized" | "balanced" = "cost-optimized"
  ): ProviderSpec[] {
    const candidates = Array.from(this.providers.values()).filter(
      (p) => p.healthy && p.supportedModels.includes(model)
    );

    switch (strategy) {
      case "cost-optimized":
        return candidates.sort((a, b) => {
          const costA = a.costPerMillionInputTokensUsd + a.costPerMillionOutputTokensUsd;
          const costB = b.costPerMillionInputTokensUsd + b.costPerMillionOutputTokensUsd;
          return costA - costB;
        });

      case "latency-optimized":
        return candidates.sort((a, b) => a.avgTtftMs - b.avgTtftMs);

      case "balanced":
      default:
        return candidates.sort((a, b) => {
          const scoreA =
            (a.costPerMillionInputTokensUsd + a.costPerMillionOutputTokensUsd) * 100 +
            a.avgTtftMs;
          const scoreB =
            (b.costPerMillionInputTokensUsd + b.costPerMillionOutputTokensUsd) * 100 +
            b.avgTtftMs;
          return scoreA - scoreB;
        });
    }
  }
}
