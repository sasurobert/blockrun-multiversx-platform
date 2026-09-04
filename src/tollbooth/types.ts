export interface BotClassificationResult {
  isBot: boolean;
  botName?: string;
  preferredContentType: "text/markdown" | "application/json" | "text/html";
  agentIdentity?: number;
  isSpoofed?: boolean;
  verificationStatus?: "verified" | "spoofed" | "unverified" | "unknown";
  clientIp?: string;
}

export interface TollPricingOptions {
  baseTollMicroUsdc?: number;
  perTokenMicroUsdc?: number;
  token?: string;
  vipDiscountPercent?: number;
}

export interface TollCalculationResult {
  microUsdc: string;
  usdFormatted: string;
  estimatedTokens: number;
  tier: "vip" | "standard" | "probe";
  merchantAddress: string;
  shard: number;
}

export interface MarkdownExtractionResult {
  markdown: string;
  title: string;
  estimatedTokens: number;
  reductionPercentage: number;
}
