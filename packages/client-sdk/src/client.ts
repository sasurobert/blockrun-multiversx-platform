import { Address, AddressComputer, Transaction, TransactionComputer } from "@multiversx/sdk-core";
import { UserSigner } from "@multiversx/sdk-wallet";
import {
  PaymentRequirements,
  X402PaymentPayload,
  McpToolDefinition,
  McpToolCallResult,
  McpResourceReadResult,
  ChatMessage,
  ChatOptions,
  ChatCompletionResponse,
} from "./types.js";
import {
  APIError,
  PaymentError,
  SpendLimitError,
  SignatureError,
} from "./errors.js";
import { IKeySigner, LocalKeySigner, getSignerBech32, getAddressBech32 } from "./signer.js";

// Safe node:fs reference for Node.js environments (bypassed in Browser)
let nodeFs: any = undefined;
if (typeof process !== "undefined" && process?.versions?.node) {
  try {
    nodeFs = (globalThis as any).require ? (globalThis as any).require("fs") : null;
  } catch {}
}

export interface MultiversxX402ClientOptions {
  signer: IKeySigner | UserSigner;
  gatewayUrl?: string;
  network?: string;
  tokenIdentifier?: string;
  maxCostPerCallUsd?: number;
  maxTotalBudgetUsd?: number;
  relayerAddress?: string;
  facilitatorUrl?: string;
  apiUrl?: string;
}

export class MultiversxX402Client {
  private readonly signer: IKeySigner;
  public readonly gatewayUrl: string;
  public readonly network: string;
  public readonly tokenIdentifier: string;
  public readonly maxCostPerCallUsd: number;
  public readonly maxTotalBudgetUsd: number;
  public totalSpentUsd: number = 0;
  private readonly relayerAddress?: string;
  private readonly facilitatorUrl: string;
  private readonly apiUrl: string;
  private readonly addressComputer: AddressComputer = new AddressComputer();
  private readonly transactionComputer: TransactionComputer = new TransactionComputer();
  private cachedNonce: number | null = null;

  constructor(options: MultiversxX402ClientOptions) {
    if (options.signer instanceof UserSigner) {
      this.signer = new LocalKeySigner(options.signer);
    } else {
      this.signer = options.signer;
    }

    this.gatewayUrl = options.gatewayUrl?.replace(/\/$/, "") || "http://127.0.0.1:3000";
    this.network = options.network || "multiversx:D";
    this.tokenIdentifier =
      options.tokenIdentifier ||
      (this.network.includes(":D") ? "USDC-350c4e" : "USDC-c76f1f");
    this.maxCostPerCallUsd = options.maxCostPerCallUsd ?? 0.05;
    this.maxTotalBudgetUsd = options.maxTotalBudgetUsd ?? 10.0;
    this.relayerAddress = options.relayerAddress;
    this.facilitatorUrl =
      options.facilitatorUrl?.replace(/\/$/, "") || this.gatewayUrl;
    this.apiUrl =
      options.apiUrl?.replace(/\/$/, "") ||
      (this.network.includes(":D")
        ? "https://devnet-api.multiversx.com"
        : this.network.includes(":T")
        ? "https://testnet-api.multiversx.com"
        : "https://api.multiversx.com");
  }

  public static fromPem(
    pemOrPath: string,
    options?: Omit<MultiversxX402ClientOptions, "signer">
  ): MultiversxX402Client {
    let pemContent = pemOrPath;
    if (!pemOrPath.includes("-----BEGIN") && nodeFs && typeof nodeFs.existsSync === "function") {
      try {
        if (nodeFs.existsSync(pemOrPath)) {
          pemContent = nodeFs.readFileSync(pemOrPath, "utf-8");
        }
      } catch {
        // Fallback to raw string
      }
    }
    const signer = LocalKeySigner.fromPem(pemContent);
    return new MultiversxX402Client({
      signer,
      ...options,
    });
  }

  public getWalletAddress(): string {
    return getSignerBech32(this.signer);
  }

  public getAddress(): Address {
    return this.signer.getAddress();
  }

  public async getNonce(): Promise<number> {
    if (this.cachedNonce !== null) {
      const n = this.cachedNonce;
      this.cachedNonce += 1;
      return n;
    }
    try {
      const bech32 = this.getWalletAddress();
      const res = await fetch(`${this.apiUrl}/accounts/${bech32}`);
      if (res.ok) {
        const data = (await res.json()) as any;
        const nonce = Number(data.nonce || 0);
        this.cachedNonce = nonce + 1;
        return nonce;
      }
    } catch {
      // fallback
    }
    return 0;
  }

  public async buildSignedX402Payment(requirements: PaymentRequirements): Promise<string> {
    const costUsd = Number(requirements.amount) / 1e6;
    if (costUsd > this.maxCostPerCallUsd) {
      throw new SpendLimitError(
        `Cost $${costUsd.toFixed(6)} exceeds maxCostPerCall limit $${this.maxCostPerCallUsd.toFixed(6)}`
      );
    }
    if (this.totalSpentUsd + costUsd > this.maxTotalBudgetUsd) {
      throw new SpendLimitError(
        `Total cumulative spend $${(this.totalSpentUsd + costUsd).toFixed(6)} exceeds total budget limit $${this.maxTotalBudgetUsd.toFixed(6)}`
      );
    }

    const nonce = await this.getNonce();
    const senderAddr = this.getAddress();
    const senderBech32 = this.getWalletAddress();
    const receiverBech32 = requirements.payTo;
    const receiverAddr = Address.newFromBech32(receiverBech32);

    const chainID = this.network.includes(":D")
      ? "D"
      : this.network.includes(":T")
      ? "T"
      : "1";
    const gasLimit = 300_000n;
    const gasPrice = 1_000_000_000n;

    // ESDTTransfer@<token_hex>@<amount_hex>
    const tokenHex = Buffer.from(requirements.asset, "ascii").toString("hex");
    let amountHex = BigInt(requirements.amount).toString(16);
    if (amountHex.length % 2 !== 0) amountHex = "0" + amountHex;
    const txData = `ESDTTransfer@${tokenHex}@${amountHex}`;

    let relayerAddrBech32 = this.relayerAddress;
    if (!relayerAddrBech32) {
      // Query relayer from gateway
      try {
        const relayerRes = await fetch(`${this.gatewayUrl}/relayer/address/${senderBech32}`);
        if (relayerRes.ok) {
          const json = (await relayerRes.json()) as any;
          relayerAddrBech32 = json.address || json.relayerAddress;
        }
      } catch {
        // use receiver as fallback relayer
        relayerAddrBech32 = receiverBech32;
      }
    }

    const tx = new Transaction({
      nonce: BigInt(nonce),
      value: 0n,
      sender: senderAddr,
      receiver: receiverAddr,
      gasPrice,
      gasLimit,
      data: Buffer.from(txData, "ascii"),
      chainID,
      version: 2,
      options: 0,
      relayer: relayerAddrBech32 ? Address.newFromBech32(relayerAddrBech32) : undefined,
    });

    const bytesToSign = this.transactionComputer.computeBytesForSigning(tx);
    const signatureBuffer = await this.signer.sign(Buffer.from(bytesToSign));
    const signatureHex = signatureBuffer.toString("hex");

    const payload: X402PaymentPayload = {
      x402Version: 2,
      scheme: requirements.scheme || "exact",
      network: this.network,
      payload: {
        nonce,
        value: "0",
        receiver: receiverBech32,
        sender: senderBech32,
        gasPrice: Number(gasPrice),
        gasLimit: Number(gasLimit),
        data: txData,
        chainID,
        version: 2,
        options: 0,
        signature: signatureHex,
        relayer: relayerAddrBech32,
      },
    };

    this.totalSpentUsd += costUsd;
    return Buffer.from(JSON.stringify(payload)).toString("base64");
  }

  public async chat(
    model: string,
    messages: ChatMessage[] | string,
    options: ChatOptions = {}
  ): Promise<ChatCompletionResponse> {
    const formattedMessages: ChatMessage[] =
      typeof messages === "string" ? [{ role: "user", content: messages }] : messages;

    const body = {
      model,
      messages: formattedMessages,
      ...options,
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Payer-Address": this.getWalletAddress(),
    };

    // First attempt: unpaid request
    let res = await fetch(`${this.gatewayUrl}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    // If HTTP 402: parse challenge, sign payment, retry
    if (res.status === 402) {
      const challengeHeader = res.headers.get("payment-required") || res.headers.get("x-payment-required");
      let challenge: any;
      if (challengeHeader) {
        challenge = JSON.parse(Buffer.from(challengeHeader, "base64").toString("utf-8"));
      } else {
        challenge = await res.json();
      }

      const reqs: PaymentRequirements = challenge.accepts?.[0];
      if (!reqs) {
        throw new PaymentError("Received HTTP 402 without valid payment requirements in challenge", 402);
      }

      const signedPaymentBase64 = await this.buildSignedX402Payment(reqs);
      headers["PAYMENT-SIGNATURE"] = signedPaymentBase64;
      headers["X-Payment-Signature"] = signedPaymentBase64;

      res = await fetch(`${this.gatewayUrl}/v1/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    }

    if (!res.ok) {
      const errorText = await res.text();
      throw new APIError(`Chat completion failed with HTTP ${res.status}: ${errorText}`, res.status);
    }

    const data = (await res.json()) as ChatCompletionResponse;
    const paymentReceipt = res.headers.get("x-payment-receipt");
    if (paymentReceipt) {
      data.paymentReceipt = paymentReceipt;
    }
    return data;
  }

  public async messages(
    model: string,
    messages: ChatMessage[] | string,
    options: ChatOptions = {}
  ): Promise<ChatCompletionResponse> {
    return await this.chat(model, messages, options);
  }

  public async listTools(): Promise<McpToolDefinition[]> {
    const res = await fetch(`${this.gatewayUrl}/mcp/v1/tools`);
    if (!res.ok) {
      throw new APIError(`Failed to list tools: HTTP ${res.status}`, res.status);
    }
    const data = (await res.json()) as any;
    return data.tools || [];
  }

  public async callTool(toolName: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Payer-Address": this.getWalletAddress(),
    };

    let res = await fetch(`${this.gatewayUrl}/mcp/v1/tools/call`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: toolName, arguments: args }),
    });

    if (res.status === 402) {
      const challengeHeader = res.headers.get("payment-required") || res.headers.get("x-payment-required");
      let challenge: any;
      if (challengeHeader) {
        challenge = JSON.parse(Buffer.from(challengeHeader, "base64").toString("utf-8"));
      } else {
        challenge = await res.json();
      }

      const reqs: PaymentRequirements = challenge.accepts?.[0];
      const signedPaymentBase64 = await this.buildSignedX402Payment(reqs);
      headers["PAYMENT-SIGNATURE"] = signedPaymentBase64;
      headers["X-Payment-Signature"] = signedPaymentBase64;

      res = await fetch(`${this.gatewayUrl}/mcp/v1/tools/call`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: toolName, arguments: args }),
      });
    }

    if (!res.ok) {
      const err = await res.text();
      throw new APIError(`MCP tool call failed: ${err}`, res.status);
    }

    return (await res.json()) as McpToolCallResult;
  }

  public async readResource(uri: string): Promise<McpResourceReadResult> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Payer-Address": this.getWalletAddress(),
    };

    let res = await fetch(`${this.gatewayUrl}/mcp/v1/resources/read`, {
      method: "POST",
      headers,
      body: JSON.stringify({ uri }),
    });

    if (res.status === 402) {
      const challengeHeader = res.headers.get("payment-required") || res.headers.get("x-payment-required");
      let challenge: any;
      if (challengeHeader) {
        challenge = JSON.parse(Buffer.from(challengeHeader, "base64").toString("utf-8"));
      } else {
        challenge = await res.json();
      }

      const reqs: PaymentRequirements = challenge.accepts?.[0];
      const signedPaymentBase64 = await this.buildSignedX402Payment(reqs);
      headers["PAYMENT-SIGNATURE"] = signedPaymentBase64;
      headers["X-Payment-Signature"] = signedPaymentBase64;

      res = await fetch(`${this.gatewayUrl}/mcp/v1/resources/read`, {
        method: "POST",
        headers,
        body: JSON.stringify({ uri }),
      });
    }

    if (!res.ok) {
      const err = await res.text();
      throw new APIError(`MCP resource read failed: ${err}`, res.status);
    }

    return (await res.json()) as McpResourceReadResult;
  }

  public async fetchProtectedMarkdown(url: string, maxPriceMicroUsdc?: number): Promise<string> {
    const headers: Record<string, string> = {
      Accept: "text/markdown",
      "User-Agent": "MultiversX-x402-ScraperBot/1.0",
    };

    let res = await fetch(url, { headers });
    if (res.status === 402) {
      const challengeHeader = res.headers.get("payment-required") || res.headers.get("x-payment-required");
      let challenge: any;
      if (challengeHeader) {
        challenge = JSON.parse(Buffer.from(challengeHeader, "base64").toString("utf-8"));
      } else {
        challenge = await res.json();
      }

      const reqs: PaymentRequirements = challenge.accepts?.[0];
      if (maxPriceMicroUsdc && parseInt(reqs.amount, 10) > maxPriceMicroUsdc) {
        throw new SpendLimitError(`Toll price ${reqs.amount} exceeds limit ${maxPriceMicroUsdc}`);
      }

      const signedPaymentBase64 = await this.buildSignedX402Payment(reqs);
      headers["PAYMENT-SIGNATURE"] = signedPaymentBase64;
      headers["X-Payment-Signature"] = signedPaymentBase64;

      res = await fetch(url, { headers });
    }

    if (!res.ok) {
      throw new APIError(`Failed to fetch markdown: HTTP ${res.status}`, res.status);
    }

    return await res.text();
  }
}

// Re-export alias
export const BlockrunMvxClient = MultiversxX402Client;
