import { MerchantPoolManager } from "../services/merchant_pool.js";
import { TollCalculationResult } from "./types.js";

export interface TollPricingEngineOptions {
  baseTollMicroUsdc?: number;
  perTokenMicroUsdc?: number;
  vipDiscountPercent?: number;
  merchantPool?: MerchantPoolManager;
}

export interface CalculateTollParams {
  estimatedTokens: number;
  reputationScore?: number;
  clientAddress?: string;
}

export class TollPricingEngine {
  private baseTollMicroUsdc: number;
  private perTokenMicroUsdc: number;
  private vipDiscountPercent: number;
  private merchantPool: MerchantPoolManager;

  constructor(options: TollPricingEngineOptions = {}) {
    this.baseTollMicroUsdc = options.baseTollMicroUsdc ?? 1000;
    this.perTokenMicroUsdc = options.perTokenMicroUsdc ?? 0.5;
    this.vipDiscountPercent = options.vipDiscountPercent ?? 20;
    this.merchantPool = options.merchantPool ?? new MerchantPoolManager();
  }

  public calculateToll(params: CalculateTollParams): TollCalculationResult {
    const rawCost =
      this.baseTollMicroUsdc + Math.round(params.estimatedTokens * this.perTokenMicroUsdc);

    let tier: "vip" | "standard" | "probe" = "standard";
    let finalCost = rawCost;

    if (params.reputationScore !== undefined) {
      if (params.reputationScore >= 90) {
        tier = "vip";
        const discount = (rawCost * this.vipDiscountPercent) / 100;
        finalCost = Math.round(rawCost - discount);
      } else if (params.reputationScore < 50) {
        tier = "probe";
        finalCost = Math.round(rawCost * 2);
      } else {
        tier = "standard";
      }
    } else {
      // Unregistered crawler default to probe rate
      tier = "probe";
      finalCost = Math.round(rawCost * 2);
    }

    const { merchantAddress, shard } = this.merchantPool.getMerchantAddressForUser(
      params.clientAddress
    );

    const microUsdcStr = Math.max(1, finalCost).toString();
    const usdValue = finalCost / 1_000_000;
    const usdFormatted = `$${usdValue.toFixed(6)}`;

    return {
      microUsdc: microUsdcStr,
      usdFormatted,
      estimatedTokens: params.estimatedTokens,
      tier,
      merchantAddress,
      shard,
    };
  }
}
