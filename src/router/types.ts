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

export interface ToolFunctionDefinition {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface ToolDefinition {
  type: "function";
  function: ToolFunctionDefinition;
}

export type ToolChoice =
  | "none"
  | "auto"
  | "required"
  | { type: "function"; function: { name: string } };

export interface ResponseFormat {
  type: "text" | "json_object" | "json_schema";
  json_schema?: {
    name: string;
    description?: string;
    schema: Record<string, unknown>;
    strict?: boolean;
  };
}

export interface ClawChatRequest {
  model: string;
  messages: Array<{
    role: string;
    content: string;
    name?: string;
    tool_calls?: unknown[];
    tool_call_id?: string;
  }>;
  routingStrategy?: "cost-optimized" | "latency-optimized" | "balanced";
  maxLatencyMs?: number;
  maxCostUsd?: number;
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  tools?: ToolDefinition[];
  tool_choice?: ToolChoice;
  response_format?: ResponseFormat;
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
