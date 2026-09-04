export interface ProviderSpec {
  id: string;
  name: string;
  endpoint: string;
  costPerMillionInputTokensUsd: number;
  costPerMillionOutputTokensUsd: number;
  avgTtftMs: number;
  tokensPerSecond: number;
  healthy: boolean;
  supportedModels: string[];
}

export interface ModelResolution {
  alias: string;
  resolvedModel: string;
  providerId: string;
  estimatedCostUsd: number;
  estimatedMicroUsdc: string;
}

export interface ClawChatRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  routingStrategy?: "cost-optimized" | "latency-optimized" | "balanced";
  maxLatencyMs?: number;
  maxCostUsd?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface ProviderStreamChunk {
  content: string;
  isFirstToken?: boolean;
  done?: boolean;
}

export interface FallbackDispatchResult {
  providerId: string;
  fallbackOccurred: boolean;
  ttftMs: number;
  stream: AsyncIterable<string>;
  totalTokens?: number;
}
