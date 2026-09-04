import { ProviderSpec } from "./types.js";

export interface ArbitragePricingOptions {
  marginPercent?: number;
  flatFeeMicroUsdc?: number;
}

export interface CalculatePriceParams {
  provider: ProviderSpec;
  inputTokens: number;
  outputTokens: number;
}

export interface ArbitragePriceResult {
  microUsdc: string;
  usdFormatted: string;
  baseMicroUsdc: string;
  marginMicroUsdc: string;
  flatFeeMicroUsdc: string;
}

export class ArbitragePricingEngine {
  private marginPercent: number;
  private flatFeeMicroUsdc: number;

  constructor(options: ArbitragePricingOptions = {}) {
    this.marginPercent = options.marginPercent ?? 10;
    this.flatFeeMicroUsdc = options.flatFeeMicroUsdc ?? 1000;
  }

  public calculatePrice(params: CalculatePriceParams): ArbitragePriceResult {
    const inputCostUsd =
      (params.inputTokens * params.provider.costPerMillionInputTokensUsd) / 1_000_000;
    const outputCostUsd =
      (params.outputTokens * params.provider.costPerMillionOutputTokensUsd) / 1_000_000;

    const baseCostUsd = inputCostUsd + outputCostUsd;
    const baseMicroUsdcNum = Math.round(baseCostUsd * 1_000_000);

    const marginMicroUsdcNum = Math.round(
      (baseMicroUsdcNum * this.marginPercent) / 100
    );

    const totalMicroUsdcNum =
      baseMicroUsdcNum + marginMicroUsdcNum + this.flatFeeMicroUsdc;

    const totalUsd = totalMicroUsdcNum / 1_000_000;

    return {
      microUsdc: totalMicroUsdcNum.toString(),
      usdFormatted: `$${totalUsd.toFixed(6)}`,
      baseMicroUsdc: baseMicroUsdcNum.toString(),
      marginMicroUsdc: marginMicroUsdcNum.toString(),
      flatFeeMicroUsdc: this.flatFeeMicroUsdc.toString(),
    };
  }
}
