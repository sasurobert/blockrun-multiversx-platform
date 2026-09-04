/**
 * @sasurobert/multiversx-x402 Domain Types & Schemas
 */

export interface PaymentRequirements {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

export interface MvxTransactionPayload {
  nonce: number;
  value: string;
  receiver: string;
  sender: string;
  gasPrice: number;
  gasLimit: number;
  data?: string;
  chainID: string;
  version: number;
  options?: number;
  signature: string;
  relayer?: string;
  relayerSignature?: string;
}

export interface X402PaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: MvxTransactionPayload;
}

export enum PaymentErrorCode {
  PAYMENT_REQUIRED = "PAYMENT_REQUIRED",
  INVALID_PAYMENT = "INVALID_PAYMENT",
  INVALID_SIGNATURE = "INVALID_SIGNATURE",
  INSUFFICIENT_FUNDS = "INSUFFICIENT_FUNDS",
  UNSUPPORTED_NETWORK = "UNSUPPORTED_NETWORK",
  UNSUPPORTED_ASSET = "UNSUPPORTED_ASSET",
  PAYMENT_EXPIRED = "PAYMENT_EXPIRED",
  SETTLEMENT_FAILED = "SETTLEMENT_FAILED",
}

export interface VerifyResponse {
  isValid: boolean;
  payer?: string;
  network?: string;
  amount?: string;
  asset?: string;
  payTo?: string;
  errorCode?: PaymentErrorCode | string;
  errorMessage?: string;
}

export interface SettleResponse {
  isSettled: boolean;
  txHash?: string;
  errorCode?: PaymentErrorCode | string;
  errorMessage?: string;
}

export interface McpToolPricing {
  microUsdc: string;
  usdFormatted: string;
  token: string;
  serviceId?: number;
  providerAgentNonce?: number;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  pricing?: McpToolPricing;
}

export interface McpToolCallResult {
  toolResult: Record<string, unknown>;
  paymentReceipt: {
    txHash: string;
    amountPaidUsdc: string;
    status: string;
  };
}

export interface McpResourceReadResult {
  uri: string;
  contents: string;
  mimeType?: string;
  paymentReceipt?: {
    txHash: string;
    amountPaidUsdc: string;
    status: string;
  };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | string;
  content: string;
}

export interface ChatOptions {
  maxTokens?: number;
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  tools?: unknown[];
  tool_choice?: unknown;
  response_format?: unknown;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  paymentReceipt?: string;
  [key: string]: unknown;
}
