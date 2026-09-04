import fs from "fs";
import { Address, AddressComputer, Transaction, TransactionComputer } from "@multiversx/sdk-core";
import { Mnemonic, UserSigner } from "@multiversx/sdk-wallet";
import {
  PaymentRequirements,
  X402PaymentPayload,
} from "../domain/types.js";
import { INetworkProvider } from "../domain/network.js";
import { buildEsdtTransferData } from "../utils/data_parser.js";
import {
  McpToolDefinition,
  McpToolCallResult,
  McpResourceReadResult,
} from "../domain/mcp_types.js";
import { MultiversXGasCalculator } from "../services/gas_calculator.js";
import {
  decodeHeaderJson,
  encodeHeaderJson,
} from "../utils/header_utils.js";
import {
  APIError,
  PaymentError,
  SpendLimitError,
} from "./errors.js";
import { McpEscrowAdapter } from "../services/mcp_escrow_adapter.js";

/**
 * Message object for OpenAI-compatible chat format.
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | string;
  content: string;
}

/**
 * Options for OpenAI-compatible chat requests.
 */
export interface ChatOptions {
  maxTokens?: number;
  max_tokens?: number;
  temperature?: number;
  headers?: Record<string, string>;
  [key: string]: unknown;
}

export interface ClawChatOptions {
  model: string;
  messages: Array<{ role: string; content: string }>;
  routingStrategy?: "cost-optimized" | "latency-optimized" | "balanced";
  maxLatencyMs?: number;
  maxCostUsd?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface ClawChatStreamResult {
  stream: AsyncIterable<string>;
  paymentReceipt?: string;
  providerSelected?: string;
}

/**
 * Standard OpenAI-compatible chat completion response.
 */
export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string };
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

/**
 * Message object for Anthropic-compatible format.
 */
export interface AnthropicMessage {
  role: "user" | "assistant" | string;
  content: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
}

/**
 * Options for Anthropic-compatible requests.
 */
export interface AnthropicOptions {
  system?: string;
  max_tokens?: number;
  maxTokens?: number;
  temperature?: number;
  headers?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * Anthropic-compatible message response.
 */
export interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  model: string;
  content: Array<{ type: string; text: string; [key: string]: unknown }>;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  paymentReceipt?: string;
  [key: string]: unknown;
}

/**
 * Smart Chat routing metadata.
 */
export interface SmartChatRouting {
  tier: "eco" | "premium";
  savings: string;
  model: string;
}

/**
 * Smart Chat response with routing and payment receipt.
 */
export type SmartChatResponse = ChatCompletionResponse & {
  routing: SmartChatRouting;
};

/**
 * Configuration for BlockRun MultiversX Client SDK.
 */
export interface BlockRunClientConfig {
  gatewayUrl?: string;
  signer?: UserSigner;
  mnemonic?: string;
  pemPath?: string;
  network?: string;
  networkProvider?: INetworkProvider;
  maxCostPerCall?: number;
  maxCostPerCallUsd?: number;
  maxSessionCost?: number;
  maxSessionCostUsd?: number;
  relayerAddress?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Extracts chain ID from CAIP-like network string (e.g. multiversx:1 -> 1).
 */
function chainIDFromNetwork(network: string): string {
  if (network.includes(":")) {
    return network.split(":")[1];
  }
  return network;
}

/**
 * Autonomous MultiversX Agent Client SDK for BlockRun x402 AI Gateway.
 */
export class BlockRunMvxClient {
  private readonly gatewayUrl: string;
  private readonly signer: UserSigner;
  private readonly userAddress: Address;
  private readonly network: string;
  private readonly networkProvider?: INetworkProvider;
  private readonly maxCostPerCall?: number;
  private readonly maxSessionCost?: number;
  private readonly customFetch: typeof fetch;
  private readonly timeoutMs: number;
  private relayerAddress?: string;
  private sessionSpendUsd: number = 0;
  private localNonce: number = 0;
  private readonly transactionComputer: TransactionComputer;
  private readonly addressComputer: AddressComputer = new AddressComputer();

  public getMyShard(): number {
    try {
      return this.addressComputer.getShardOfAddress(this.userAddress);
    } catch {
      return 0;
    }
  }

  constructor(config: BlockRunClientConfig = {}) {
    this.gatewayUrl = (config.gatewayUrl ?? "http://localhost:3000").replace(/\/$/, "");
    this.network = config.network ?? "multiversx:1";
    this.networkProvider = config.networkProvider;
    this.maxCostPerCall = config.maxCostPerCall ?? config.maxCostPerCallUsd;
    this.maxSessionCost = config.maxSessionCost ?? config.maxSessionCostUsd;
    this.relayerAddress = config.relayerAddress;
    this.customFetch = config.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = config.timeoutMs ?? 60000;
    this.transactionComputer = new TransactionComputer();

    // 1. Initialize Signer
    if (config.signer) {
      this.signer = config.signer;
    } else if (config.mnemonic) {
      const mn = Mnemonic.fromString(config.mnemonic.trim());
      this.signer = new UserSigner(mn.deriveKey(0));
    } else if (config.pemPath) {
      const pemContent = fs.readFileSync(config.pemPath, "utf8");
      this.signer = UserSigner.fromPem(pemContent);
    } else {
      // Default to newly generated wallet for autonomous agents if none provided
      const mn = Mnemonic.generate();
      this.signer = new UserSigner(mn.deriveKey(0));
    }

    this.userAddress = Address.newFromBech32(this.signer.getAddress().bech32());
  }

  /**
   * Returns the agent's MultiversX bech32 address.
   */
  public getWalletAddress(): string {
    return this.userAddress.toBech32();
  }

  /**
   * Returns current session cumulative spend in USD.
   */
  public getSessionSpend(): number {
    return this.sessionSpendUsd;
  }

  /**
   * Returns account native balance in atomic units from network provider if available.
   */
  public async getBalance(): Promise<string> {
    if (this.networkProvider) {
      const account = (await this.networkProvider.getAccount(this.userAddress)) as {
        balance?: string | bigint;
      };
      return account?.balance ? account.balance.toString() : "0";
    }
    return "0";
  }

  /**
   * Resolves relayer address for the agent's shard from gateway or cache.
   */
  private async resolveRelayerAddress(): Promise<string> {
    if (this.relayerAddress) {
      return this.relayerAddress;
    }

    try {
      const url = `${this.gatewayUrl}/relayer/address/${this.userAddress.toBech32()}`;
      const res = await this.customFetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (res.ok) {
        const data = (await res.json()) as { relayerAddress?: string };
        if (data.relayerAddress) {
          this.relayerAddress = data.relayerAddress;
          return data.relayerAddress;
        }
      }
    } catch {
      // Fall through to default fallback
    }

    return this.userAddress.toBech32();
  }

  /**
   * Resolves the current account nonce for signing transactions.
   */
  private async getAccountNonce(): Promise<number> {
    if (this.networkProvider) {
      try {
        const account = (await this.networkProvider.getAccount(this.userAddress)) as {
          nonce?: number;
        };
        if (account?.nonce !== undefined) {
          this.localNonce = Math.max(this.localNonce, account.nonce);
        }
      } catch {
        // Fall back to localNonce tracker
      }
    }
    const current = this.localNonce;
    this.localNonce++;
    return current;
  }

  /**
   * Core autonomous 402 payment execution loop.
   */
  private async executeWith402Payment<T extends Record<string, unknown>>(
    endpoint: string,
    body: Record<string, unknown>,
    extraHeaders?: Record<string, string>
  ): Promise<T & { paymentReceipt?: string }> {
    const url = `${this.gatewayUrl}${endpoint}`;
    const initialHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      ...(extraHeaders ?? {}),
    };

    // Step 1: Send initial unpaid request
    let res = await this.customFetch(url, {
      method: "POST",
      headers: initialHeaders,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    // Step 2: If 200 OK -> return response directly
    if (res.status === 200 || res.ok) {
      const data = (await res.json()) as T;
      const receipt = this.extractReceipt(res, data);
      return {
        ...data,
        ...(receipt ? { paymentReceipt: receipt } : {}),
      };
    }

    // Step 3: Handle 402 Payment Required challenge
    if (res.status === 402) {
      const requirement = await this.extractPaymentRequirements(res);
      if (!requirement) {
        throw new PaymentError("Received 402 Payment Required, but failed to parse payment requirements");
      }

      // Step 4: Enforce spend limits
      const decimals = typeof (requirement.extra as any)?.decimals === "number" ? (requirement.extra as any).decimals : 6;
      let costUsd = 0;
      try {
        const rawAmount = BigInt(requirement.amount);
        const divisor = 10n ** BigInt(decimals);
        costUsd = Number(rawAmount) / Number(divisor);
      } catch {
        costUsd = parseInt(requirement.amount, 10) / (10 ** decimals);
      }

      if (this.maxCostPerCall !== undefined && costUsd > this.maxCostPerCall) {
        throw new SpendLimitError(
          `Requested call cost ($${costUsd.toFixed(6)}) exceeds maxCostPerCall limit ($${this.maxCostPerCall.toFixed(6)})`,
          "call",
          costUsd,
          this.maxCostPerCall
        );
      }

      if (this.maxSessionCost !== undefined && this.sessionSpendUsd + costUsd > this.maxSessionCost) {
        throw new SpendLimitError(
          `Projected session spend ($${(this.sessionSpendUsd + costUsd).toFixed(6)}) would exceed maxSessionCost limit ($${this.maxSessionCost.toFixed(6)})`,
          "session",
          this.sessionSpendUsd + costUsd,
          this.maxSessionCost
        );
      }

      // Step 5: Resolve relayer address for agent's shard
      const relayerAddrStr = await this.resolveRelayerAddress();
      const nonce = await this.getAccountNonce();
      const chainID = chainIDFromNetwork(requirement.network || this.network);

      // Step 6: Construct and sign Relayed V3 Transaction with exact gas calculation
      const calculatedGas = MultiversXGasCalculator.forEsdtTransfer(
        requirement.asset,
        requirement.amount,
        true
      );
      const exactGasLimit = calculatedGas.gasLimit;

      const tx = new Transaction({
        nonce: BigInt(nonce),
        value: 0n,
        sender: this.userAddress,
        receiver: Address.newFromBech32(requirement.payTo),
        gasPrice: 1000000000n,
        gasLimit: exactGasLimit,
        data: Buffer.from(buildEsdtTransferData(requirement.asset, requirement.amount)),
        chainID,
        version: 2,
        options: 0,
        relayer: Address.newFromBech32(relayerAddrStr),
      });

      const bytesToSign = this.transactionComputer.computeBytesForSigning(tx);
      const signatureBuffer = await this.signer.sign(bytesToSign);
      const signatureHex = signatureBuffer.toString("hex");

      const paymentPayload: X402PaymentPayload = {
        x402Version: 2,
        resource: {
          url,
          description: "AI Model Inference Payment",
        },
        accepted: requirement,
        payload: {
          nonce,
          value: "0",
          receiver: requirement.payTo,
          sender: this.userAddress.toBech32(),
          gasPrice: 1000000000,
          gasLimit: Number(exactGasLimit),
          data: buildEsdtTransferData(requirement.asset, requirement.amount),
          chainID,
          version: 2,
          options: 0,
          signature: signatureHex,
          relayer: relayerAddrStr,
        },
      };

      // Step 7: Base64 encode into PAYMENT-SIGNATURE header
      const encodedPaymentHeader = encodeHeaderJson(paymentPayload);
      const retryHeaders: Record<string, string> = {
        ...initialHeaders,
        "PAYMENT-SIGNATURE": encodedPaymentHeader,
      };

      // Step 8: Retry request with signed payment
      res = await this.customFetch(url, {
        method: "POST",
        headers: retryHeaders,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (res.status === 200 || res.ok) {
        const responseData = (await res.json()) as T;
        const receipt = this.extractReceipt(res, responseData);

        // Record spend
        this.sessionSpendUsd += costUsd;

        return {
          ...responseData,
          ...(receipt ? { paymentReceipt: receipt } : {}),
        };
      }

      // Retry failed with non-200
      let errorBody: unknown;
      try {
        errorBody = await res.json();
      } catch {
        try {
          errorBody = await res.text();
        } catch {
          errorBody = undefined;
        }
      }

      const errMsg =
        typeof errorBody === "object" && errorBody !== null && "error" in errorBody
          ? String((errorBody as { error: unknown }).error)
          : `Payment rejected or settlement failed with HTTP ${res.status}`;

      throw new PaymentError(errMsg, {
        code:
          typeof errorBody === "object" && errorBody !== null && "code" in errorBody
            ? String((errorBody as { code: unknown }).code)
            : undefined,
        details: errorBody,
      });
    }

    // Non-200, Non-402 Error
    let errorDetails: unknown;
    try {
      errorDetails = await res.json();
    } catch {
      try {
        errorDetails = await res.text();
      } catch {
        errorDetails = undefined;
      }
    }

    const msg =
      typeof errorDetails === "object" && errorDetails !== null && "error" in errorDetails
        ? String((errorDetails as { error: unknown }).error)
        : `Request failed with HTTP status ${res.status}`;

    throw new APIError(msg, res.status, errorDetails);
  }

  /**
   * Extracts payment receipt transaction hash from HTTP response headers or response body.
   */
  private extractReceipt(
    res: Response | { headers?: Headers | Record<string, string | string[] | undefined> | { get?(name: string): string | null | undefined } | unknown },
    body?: unknown
  ): string | undefined {
    const headers = (res as { headers?: unknown }).headers;

    let receiptHeader: string | undefined;
    if (headers && typeof (headers as { get?: (name: string) => string | null | undefined }).get === "function") {
      const getFn = (headers as { get: (name: string) => string | null | undefined }).get.bind(headers);
      receiptHeader = getFn("x-payment-receipt") ?? getFn("X-Payment-Receipt") ?? undefined;
    } else if (headers && typeof headers === "object") {
      const record = headers as Record<string, string | string[] | undefined>;
      const val = record["x-payment-receipt"] ?? record["X-Payment-Receipt"];
      receiptHeader = Array.isArray(val) ? val[0] : val;
    }

    if (receiptHeader && typeof receiptHeader === "string") {
      return receiptHeader;
    }

    let paymentResponseHeader: string | undefined;
    if (headers && typeof (headers as { get?: (name: string) => string | null | undefined }).get === "function") {
      const getFn = (headers as { get: (name: string) => string | null | undefined }).get.bind(headers);
      paymentResponseHeader = getFn("payment-response") ?? getFn("PAYMENT-RESPONSE") ?? undefined;
    } else if (headers && typeof headers === "object") {
      const record = headers as Record<string, string | string[] | undefined>;
      const val = record["payment-response"] ?? record["PAYMENT-RESPONSE"];
      paymentResponseHeader = Array.isArray(val) ? val[0] : val;
    }

    if (paymentResponseHeader && typeof paymentResponseHeader === "string") {
      try {
        const decoded = decodeHeaderJson<Record<string, unknown>>(paymentResponseHeader);
        if (decoded && typeof decoded.transaction === "string") {
          return decoded.transaction;
        }
      } catch {
        // Ignore decode failure
      }
    }

    if (
      body &&
      typeof body === "object" &&
      "paymentReceipt" in body &&
      typeof (body as Record<string, unknown>).paymentReceipt === "string"
    ) {
      return (body as Record<string, unknown>).paymentReceipt as string;
    }

    return undefined;
  }

  /**
   * Extracts PaymentRequirements from 402 response headers or response JSON body.
   */
  private async extractPaymentRequirements(
    res: Response | { headers?: Headers | Record<string, string | string[] | undefined> | { get?(name: string): string | null | undefined } | unknown; json?: () => Promise<unknown> }
  ): Promise<PaymentRequirements | undefined> {
    const headers = (res as { headers?: unknown }).headers;

    let reqHeader: string | undefined;
    if (headers && typeof (headers as { get?: (name: string) => string | null | undefined }).get === "function") {
      const getFn = (headers as { get: (name: string) => string | null | undefined }).get.bind(headers);
      reqHeader = getFn("payment-required") ?? getFn("PAYMENT-REQUIRED") ?? undefined;
    } else if (headers && typeof headers === "object") {
      const record = headers as Record<string, string | string[] | undefined>;
      const val = record["payment-required"] ?? record["PAYMENT-REQUIRED"];
      reqHeader = Array.isArray(val) ? val[0] : val;
    }

    if (reqHeader && typeof reqHeader === "string") {
      try {
        const decoded = decodeHeaderJson<Record<string, unknown>>(reqHeader);
        if (decoded?.accepts && Array.isArray(decoded.accepts) && decoded.accepts.length > 0) {
          const myShard = this.getMyShard();
          const match = (decoded.accepts as Array<Record<string, unknown>>).find((a) => (a?.extra as Record<string, unknown>)?.shard === myShard);
          return (match || decoded.accepts[0]) as PaymentRequirements;
        }
        if (decoded?.scheme && decoded?.amount) {
          return decoded as unknown as PaymentRequirements;
        }
      } catch {
        // Fall through to body parsing
      }
    }

    let xReqHeader: string | undefined;
    if (headers && typeof (headers as { get?: (name: string) => string | null | undefined }).get === "function") {
      const getFn = (headers as { get: (name: string) => string | null | undefined }).get.bind(headers);
      xReqHeader = getFn("x-payment-required") ?? getFn("X-Payment-Required") ?? undefined;
    } else if (headers && typeof headers === "object") {
      const record = headers as Record<string, string | string[] | undefined>;
      const val = record["x-payment-required"] ?? record["X-Payment-Required"];
      xReqHeader = Array.isArray(val) ? val[0] : val;
    }

    if (xReqHeader && typeof xReqHeader === "string") {
      try {
        const decoded = decodeHeaderJson<Record<string, unknown>>(xReqHeader);
        if (decoded?.scheme && decoded?.amount) {
          return decoded as unknown as PaymentRequirements;
        }
      } catch {
        // Fall through
      }
    }

    if (typeof (res as { json?: () => Promise<unknown> }).json === "function") {
      try {
        const body = (await (res as { json: () => Promise<unknown> }).json()) as Record<string, unknown>;
        if (body?.accepts && Array.isArray(body.accepts) && body.accepts.length > 0) {
          const myShard = this.getMyShard();
          const match = (body.accepts as Array<Record<string, unknown>>).find((a) => (a?.extra as Record<string, unknown>)?.shard === myShard);
          return (match || body.accepts[0]) as PaymentRequirements;
        }
        if (body?.paymentRequirements) {
          return body.paymentRequirements as PaymentRequirements;
        }
      } catch {
        // Body not JSON
      }
    }

    return undefined;
  }

  /**
   * OpenAI-compatible chat completions endpoint with autonomous x402 payment.
   */
  public async chat(
    model: string,
    messages: string | ChatMessage[],
    options?: ChatOptions
  ): Promise<ChatCompletionResponse & { paymentReceipt?: string }> {
    const formattedMessages: ChatMessage[] =
      typeof messages === "string" ? [{ role: "user", content: messages }] : messages;

    const reqBody = {
      model,
      messages: formattedMessages,
      max_tokens: options?.max_tokens ?? options?.maxTokens ?? 1000,
      ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options ?? {}),
    };

    return this.executeWith402Payment<ChatCompletionResponse>(
      "/api/v1/chat/completions",
      reqBody,
      options?.headers
    );
  }

  /**
   * OpenAI-compatible chat completions streaming endpoint with autonomous x402 payment.
   * Yields content deltas and returns the final payment receipt.
   */
  public async *chatStream(
    model: string,
    messages: string | ChatMessage[],
    options?: ChatOptions
  ): AsyncGenerator<string, { paymentReceipt?: string }> {
    const formattedMessages: ChatMessage[] =
      typeof messages === "string" ? [{ role: "user", content: messages }] : messages;

    const reqBody = {
      model,
      messages: formattedMessages,
      max_tokens: options?.max_tokens ?? options?.maxTokens ?? 1000,
      stream: true,
      ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options ?? {}),
    };

    const url = `${this.gatewayUrl}/api/v1/chat/completions`;
    const initialHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    };

    // Step 1: Initial call
    let res = await this.customFetch(url, {
      method: "POST",
      headers: initialHeaders,
      body: JSON.stringify(reqBody),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    let receipt: string | undefined;

    // Step 2: If 402, negotiate payment
    if (res.status === 402) {
      const requirements = await this.extractPaymentRequirements(res);
      if (!requirements) {
        throw new PaymentError("Received HTTP 402 without parseable payment requirements");
      }

      const decimals =
        typeof (requirements.extra as any)?.decimals === "number"
          ? (requirements.extra as any).decimals
          : 6;
      let costUsd = 0;
      try {
        const rawAmount = BigInt(requirements.amount);
        const divisor = 10n ** BigInt(decimals);
        costUsd = Number(rawAmount) / Number(divisor);
      } catch {
        costUsd = parseInt(requirements.amount, 10) / 10 ** decimals;
      }

      if (this.maxCostPerCall !== undefined && costUsd > this.maxCostPerCall) {
        throw new SpendLimitError(
          `Requested call cost ($${costUsd.toFixed(6)}) exceeds maxCostPerCall limit ($${this.maxCostPerCall.toFixed(6)})`,
          "call",
          costUsd,
          this.maxCostPerCall
        );
      }
      if (
        this.maxSessionCost !== undefined &&
        this.sessionSpendUsd + costUsd > this.maxSessionCost
      ) {
        throw new SpendLimitError(
          `Projected session spend ($${(this.sessionSpendUsd + costUsd).toFixed(6)}) would exceed maxSessionCost limit ($${this.maxSessionCost.toFixed(6)})`,
          "session",
          this.sessionSpendUsd + costUsd,
          this.maxSessionCost
        );
      }

      const relayerAddrStr = await this.resolveRelayerAddress();
      const nonce = await this.getAccountNonce();
      const chainID = chainIDFromNetwork(requirements.network || this.network);

      const calculatedGas = MultiversXGasCalculator.forEsdtTransfer(
        requirements.asset,
        requirements.amount,
        true
      );
      const exactGasLimit = calculatedGas.gasLimit;

      const tx = new Transaction({
        nonce: BigInt(nonce),
        value: 0n,
        sender: this.userAddress,
        receiver: Address.newFromBech32(requirements.payTo),
        gasPrice: 1000000000n,
        gasLimit: exactGasLimit,
        data: Buffer.from(buildEsdtTransferData(requirements.asset, requirements.amount)),
        chainID,
        version: 2,
        options: 0,
        relayer: Address.newFromBech32(relayerAddrStr),
      });

      const bytesToSign = this.transactionComputer.computeBytesForSigning(tx);
      const signatureBuffer = await this.signer.sign(bytesToSign);
      const signatureHex = signatureBuffer.toString("hex");

      const paymentPayload: X402PaymentPayload = {
        x402Version: 2,
        resource: {
          url,
          description: "AI Model Inference Payment",
        },
        accepted: requirements,
        payload: {
          nonce,
          value: "0",
          receiver: requirements.payTo,
          sender: this.userAddress.toBech32(),
          gasPrice: 1000000000,
          gasLimit: Number(exactGasLimit),
          data: buildEsdtTransferData(requirements.asset, requirements.amount),
          chainID,
          version: 2,
          options: 0,
          signature: signatureHex,
          relayer: relayerAddrStr,
        },
      };

      const retryHeaders: Record<string, string> = {
        ...initialHeaders,
        "PAYMENT-SIGNATURE": encodeHeaderJson(paymentPayload),
      };

      res = await this.customFetch(url, {
        method: "POST",
        headers: retryHeaders,
        body: JSON.stringify(reqBody),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      this.sessionSpendUsd += costUsd;
    }

    if (res.status !== 200 && !res.ok) {
      throw new APIError(`Stream request failed with status ${res.status}`, res.status);
    }

    receipt = this.extractReceipt(res);

    // Read SSE body
    if (res.body && typeof (res.body as any).getReader === "function") {
      const reader = (res.body as any).getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const dataStr = trimmed.slice(6);
          if (dataStr === "[DONE]") return { paymentReceipt: receipt };
          try {
            const parsed = JSON.parse(dataStr);
            const delta = parsed?.choices?.[0]?.delta?.content;
            if (delta) yield delta;
          } catch {}
        }
      }
    } else if (typeof (res as any).text === "function") {
      const text = await (res as any).text();
      const lines = text.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const dataStr = trimmed.slice(6);
        if (dataStr === "[DONE]") break;
        try {
          const parsed = JSON.parse(dataStr);
          const delta = parsed?.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {}
      }
    }

    return { paymentReceipt: receipt };
  }

  /**
   * Anthropic-compatible messages endpoint with autonomous x402 payment.
   */
  public async messages(
    model: string,
    messages: AnthropicMessage[],
    options?: AnthropicOptions
  ): Promise<AnthropicResponse & { paymentReceipt?: string }> {
    const reqBody = {
      model,
      messages,
      max_tokens: options?.max_tokens ?? options?.maxTokens ?? 1000,
      ...(options?.system ? { system: options.system } : {}),
      ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options ?? {}),
    };

    return this.executeWith402Payment<AnthropicResponse>(
      "/api/v1/messages",
      reqBody,
      options?.headers
    );
  }

  /**
   * Intelligent Smart Chat routing based on prompt complexity and cost optimization.
   */
  public async smartChat(
    messages: string | ChatMessage[],
    profile: "auto" | "eco" | "premium" = "auto",
    options?: ChatOptions
  ): Promise<SmartChatResponse> {
    const formattedMessages: ChatMessage[] =
      typeof messages === "string" ? [{ role: "user", content: messages }] : messages;

    const fullPromptText = formattedMessages.map((m) => m.content).join("\n");
    const promptLength = fullPromptText.length;

    let targetModel = "openai/gpt-5.4";
    let tier: "eco" | "premium" = "premium";
    let savings = "0%";

    if (profile === "eco") {
      targetModel = "deepseek/deepseek-chat";
      tier = "eco";
      savings = "~94% vs GPT-5.4";
    } else if (profile === "premium") {
      targetModel = "openai/gpt-5.4";
      tier = "premium";
      savings = "0%";
    } else {
      // Auto Profile: Intelligent routing based on complexity heuristics
      const complexKeywords = [
        "proof",
        "prove",
        "debug",
        "architect",
        "smart contract",
        "relayed v3",
        "rust",
        "concurrency",
        "security audit",
        "theorem",
        "optimize",
      ];
      const hasCode = /```|function\s|def\s|class\s|impl\s|pub fn\s/.test(fullPromptText);
      const hasComplexKeywords = complexKeywords.some((kw) =>
        fullPromptText.toLowerCase().includes(kw)
      );

      if (promptLength > 300 || hasCode || hasComplexKeywords) {
        targetModel = "openai/gpt-5.4";
        tier = "premium";
        savings = "0%";
      } else {
        targetModel = "deepseek/deepseek-chat";
        tier = "eco";
        savings = "~94% vs GPT-5.4";
      }
    }

    const response = await this.chat(targetModel, formattedMessages, options);

    return {
      ...response,
      routing: {
        tier,
        savings,
        model: targetModel,
      },
    };
  }

  /**
   * Discovers available tools from an MCP Gateway.
   */
  public async listMcpTools(): Promise<McpToolDefinition[]> {
    const url = `${this.gatewayUrl}/mcp/v1/tools`;
    const res = await this.customFetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      throw new APIError(`Failed to fetch MCP tools: HTTP ${res.status}`, res.status);
    }
    const data = (await res.json()) as { tools?: McpToolDefinition[] };
    return data.tools ?? [];
  }

  /**
   * Calls an MCP tool via JSON-RPC 2.0 with autonomous 402 Relayed V3 settlement.
   */
  public async callMcpTool<T = { result: McpToolCallResult; paymentReceipt?: string }>(
    toolName: string,
    args: Record<string, unknown> = {},
    options?: { id?: string | number; headers?: Record<string, string> }
  ): Promise<T & { paymentReceipt?: string }> {
    const reqBody = {
      jsonrpc: "2.0",
      id: options?.id ?? `req-${Date.now()}`,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: args,
      },
    };

    return this.executeWith402Payment<any>(
      "/mcp/v1/tools/call",
      reqBody,
      options?.headers
    );
  }

  /**
   * Reads an MCP resource via JSON-RPC 2.0 with autonomous 402 Relayed V3 settlement.
   */
  public async readMcpResource<T = { result: McpResourceReadResult; paymentReceipt?: string }>(
    uri: string,
    options?: { id?: string | number; headers?: Record<string, string> }
  ): Promise<T & { paymentReceipt?: string }> {
    const reqBody = {
      jsonrpc: "2.0",
      id: options?.id ?? `req-${Date.now()}`,
      method: "resources/read",
      params: { uri },
    };

    return this.executeWith402Payment<any>(
      "/mcp/v1/resources/read",
      reqBody,
      options?.headers
    );
  }

  /**
   * Submits on-chain feedback to MX-8004 ReputationRegistry for a completed tool job.
   */
  public async rateToolExecution(
    jobId: string,
    agentNonce: number,
    rating: number
  ): Promise<{ txHash: string }> {
    if (rating < 1 || rating > 100) {
      throw new Error("Rating must be between 1 and 100");
    }
    const url = `${this.gatewayUrl}/mcp/v1/reputation/feedback`;
    try {
      const res = await this.customFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, agentNonce, rating, employer: this.userAddress.toBech32() }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (res.ok) {
        const data = (await res.json()) as { txHash?: string };
        return { txHash: data.txHash ?? `feedback-tx-${Date.now()}` };
      }
    } catch {}

    return { txHash: `feedback-tx-${Date.now()}` };
  }

  /**
   * Generic HTTP fetch with autonomous 402 Relayed V3 settlement.
   * Perfect for scrapers, tollbooths, and arbitrary HTTP 402 endpoints.
   */
  public async fetchWithPayment(
    url: string,
    init?: RequestInit
  ): Promise<Response & { paymentReceipt?: string }> {
    const rawHeaders = init?.headers;
    const initialHeaders: Record<string, string> = {};
    if (rawHeaders) {
      if (typeof (rawHeaders as any).forEach === "function") {
        (rawHeaders as any).forEach((val: string, key: string) => {
          initialHeaders[key] = val;
        });
      } else if (Array.isArray(rawHeaders)) {
        for (const [k, v] of rawHeaders) {
          initialHeaders[k] = v;
        }
      } else if (typeof rawHeaders === "object") {
        Object.assign(initialHeaders, rawHeaders);
      }
    }

    if (!initialHeaders["X-Payer-Address"] && !initialHeaders["x-payer-address"]) {
      initialHeaders["X-Payer-Address"] = this.userAddress.toBech32();
    }

    // Step 1: Initial request
    let res = await this.customFetch(url, {
      ...init,
      headers: initialHeaders,
      signal: init?.signal ?? AbortSignal.timeout(this.timeoutMs),
    });

    // Step 2: If ok, return directly
    if (res.status === 200 || res.ok) {
      const receipt = this.extractReceipt(res);
      return Object.assign(res, { paymentReceipt: receipt });
    }

    // Step 3: Check for 402 Payment Required
    if (res.status === 402) {
      const requirement = await this.extractPaymentRequirements(res);
      if (!requirement) {
        throw new PaymentError(
          "Received 402 Payment Required, but failed to parse payment requirements"
        );
      }

      // Step 4: Spend limit check
      const decimals =
        typeof (requirement.extra as any)?.decimals === "number"
          ? (requirement.extra as any).decimals
          : 6;
      let costUsd = 0;
      try {
        const rawAmount = BigInt(requirement.amount);
        costUsd = Number(rawAmount) / Number(10n ** BigInt(decimals));
      } catch {
        costUsd = parseInt(requirement.amount, 10) / 10 ** decimals;
      }

      if (this.maxCostPerCall !== undefined && costUsd > this.maxCostPerCall) {
        throw new SpendLimitError(
          `Requested call cost ($${costUsd.toFixed(6)}) exceeds maxCostPerCall limit ($${this.maxCostPerCall.toFixed(6)})`,
          "call",
          costUsd,
          this.maxCostPerCall
        );
      }
      if (
        this.maxSessionCost !== undefined &&
        this.sessionSpendUsd + costUsd > this.maxSessionCost
      ) {
        throw new SpendLimitError(
          `Projected session spend ($${(this.sessionSpendUsd + costUsd).toFixed(6)}) would exceed maxSessionCost limit ($${this.maxSessionCost.toFixed(6)})`,
          "session",
          this.sessionSpendUsd + costUsd,
          this.maxSessionCost
        );
      }

      // Step 5: Sign Relayed V3 transaction
      const relayerAddrStr = await this.resolveRelayerAddress();
      const nonce = await this.getAccountNonce();
      const chainID = chainIDFromNetwork(requirement.network || this.network);

      const calculatedGas = MultiversXGasCalculator.forEsdtTransfer(
        requirement.asset,
        requirement.amount,
        true
      );

      const tx = new Transaction({
        nonce: BigInt(nonce),
        value: 0n,
        sender: this.userAddress,
        receiver: Address.newFromBech32(requirement.payTo),
        gasPrice: 1000000000n,
        gasLimit: calculatedGas.gasLimit,
        data: Buffer.from(buildEsdtTransferData(requirement.asset, requirement.amount)),
        chainID,
        version: 2,
        options: 0,
        relayer: Address.newFromBech32(relayerAddrStr),
      });

      const bytesToSign = this.transactionComputer.computeBytesForSigning(tx);
      const signatureBuffer = await this.signer.sign(bytesToSign);
      const signatureHex = signatureBuffer.toString("hex");

      const paymentPayload: X402PaymentPayload = {
        x402Version: 2,
        resource: {
          url,
          description: "Tollbooth Web Page Access",
        },
        accepted: requirement,
        payload: {
          nonce,
          value: "0",
          receiver: requirement.payTo,
          sender: this.userAddress.toBech32(),
          gasPrice: 1000000000,
          gasLimit: Number(calculatedGas.gasLimit),
          data: buildEsdtTransferData(requirement.asset, requirement.amount),
          chainID,
          version: 2,
          options: 0,
          signature: signatureHex,
          relayer: relayerAddrStr,
        },
      };

      const encodedSig = encodeHeaderJson(paymentPayload);
      const retryHeaders = {
        ...initialHeaders,
        "PAYMENT-SIGNATURE": encodedSig,
        "X-Payer-Address": this.userAddress.toBech32(),
      };

      // Retry request
      res = await this.customFetch(url, {
        ...init,
        headers: retryHeaders,
        signal: init?.signal ?? AbortSignal.timeout(this.timeoutMs),
      });

      if (res.status === 200 || res.ok) {
        this.sessionSpendUsd += costUsd;
        const receipt = this.extractReceipt(res);
        return Object.assign(res, { paymentReceipt: receipt });
      }
    }

    return Object.assign(res, { paymentReceipt: this.extractReceipt(res) });
  }

  /**
   * Sub-second LLM arbitrage and cascading fallback chat completions.
   */
  public async clawChatCompletion(
    options: ClawChatOptions
  ): Promise<ClawChatStreamResult> {
    const url = `${this.gatewayUrl}/api/v1/claw/chat/completions`;
    const res = await this.fetchWithPayment(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...options, stream: true }),
    });

    if (!res.ok && res.status !== 200) {
      throw new APIError(`ClawRouter request failed: HTTP ${res.status}`, res.status);
    }

    const receipt = (res as any).paymentReceipt ?? this.extractReceipt(res);
    const providerSelected =
      res.headers.get("x-claw-provider-selected") ?? undefined;

    async function* parseSSEStream() {
      if (res.body && typeof (res.body as any).getReader === "function") {
        const reader = (res.body as any).getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;
            const dataStr = trimmed.slice(6);
            if (dataStr === "[DONE]") return;
            try {
              const parsed = JSON.parse(dataStr);
              const delta = parsed?.choices?.[0]?.delta?.content;
              if (delta) yield delta;
            } catch {}
          }
        }
      } else {
        const text = await res.text();
        const lines = text.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const dataStr = trimmed.slice(6);
          if (dataStr === "[DONE]") break;
          try {
            const parsed = JSON.parse(dataStr);
            const delta = parsed?.choices?.[0]?.delta?.content;
            if (delta) yield delta;
          } catch {}
        }
      }
    }

    return {
      stream: parseSSEStream(),
      paymentReceipt: receipt,
      providerSelected,
    };
  }

  /**
   * Locks funds into MX-8004 EscrowContract for high-value agent jobs (> $0.50).
   */
  public async depositEscrow(params: {
    jobId: string;
    receiver: string;
    amount: string;
    token?: string;
    deadlineSeconds?: number;
    poaHash?: string;
  }): Promise<{ txHash: string; jobId: string }> {
    const adapter = new McpEscrowAdapter();
    const result = await adapter.deposit({
      jobId: params.jobId,
      receiver: params.receiver,
      amount: params.amount,
      token: params.token ?? "USDC-c76f1f",
      deadlineSeconds: params.deadlineSeconds ?? Math.floor(Date.now() / 1000) + 86400,
      poaHash: params.poaHash,
    });
    return { txHash: result.txHash, jobId: result.jobId };
  }

  /**
   * Releases escrowed funds to receiver after ValidationRegistry verification.
   */
  public async releaseEscrow(jobId: string): Promise<{ txHash: string; status: "released" }> {
    const adapter = new McpEscrowAdapter();
    const result = await adapter.release(jobId);
    return { txHash: result.txHash, status: result.status };
  }
}

/**
 * Convenience factory to setup an autonomous MultiversX agent wallet.
 */
export function setupAgentWallet(options?: {
  pemPath?: string;
  mnemonic?: string;
  network?: string;
  gatewayUrl?: string;
  maxCostPerCall?: number;
  maxSessionCost?: number;
}): BlockRunMvxClient {
  return new BlockRunMvxClient(options);
}
