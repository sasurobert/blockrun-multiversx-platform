import crypto from "crypto";
import { Address, Transaction, TransactionComputer } from "@multiversx/sdk-core";
import { INetworkProvider, ISimulationResult } from "../domain/network.js";

export interface BatchNetworkProviderConfig {
  mode?: "live" | "simulation";
  apiUrl?: string;
  timeoutMs?: number;
  strictNonceCheck?: boolean;
}

export class BatchNetworkProvider implements INetworkProvider {
  private readonly mode: "live" | "simulation";
  private readonly apiUrl: string;
  private readonly timeoutMs: number;
  private readonly strictNonceCheck: boolean;
  private readonly transactionComputer: TransactionComputer;
  private totalSent: number = 0;
  private readonly relayerNonces: Map<string, Set<number>> = new Map();

  constructor(config?: BatchNetworkProviderConfig) {
    this.mode = config?.mode ?? "live";
    this.apiUrl = config?.apiUrl?.replace(/\/$/, "") ?? "https://devnet-api.multiversx.com";
    this.timeoutMs = config?.timeoutMs ?? 15000;
    this.strictNonceCheck = config?.strictNonceCheck ?? false;
    this.transactionComputer = new TransactionComputer();
  }

  getTotalSentCount(): number {
    return this.totalSent;
  }

  async simulateTransaction(tx: Transaction): Promise<ISimulationResult> {
    if (this.mode === "simulation") {
      return { status: "success", returnCode: "ok" };
    }
    const plainTx = tx.toPlainObject();
    const res = await fetch(`${this.apiUrl}/transaction/simulate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(plainTx),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      throw new Error(`Simulation request failed: ${res.statusText}`);
    }
    const data = (await res.json()) as any;
    return {
      status: data?.data?.result?.status ?? "success",
      returnCode: data?.data?.result?.returnCode,
    };
  }

  async sendTransaction(tx: Transaction): Promise<string> {
    const hashes = await this.sendTransactions([tx]);
    return hashes[0];
  }

  async sendTransactions(txs: Transaction[]): Promise<string[]> {
    if (txs.length === 0) return [];

    if (this.mode === "simulation") {
      const hashes: string[] = [];
      for (const tx of txs) {
        const sender =
          typeof tx.sender?.toBech32 === "function" ? tx.sender.toBech32() : String(tx.sender);
        const nonce = Number(tx.nonce);

        if (this.strictNonceCheck) {
          let nonces = this.relayerNonces.get(sender);
          if (!nonces) {
            nonces = new Set<number>();
            this.relayerNonces.set(sender, nonces);
          }
          if (nonces.has(nonce)) {
            throw new Error(`Nonce collision detected for ${sender} at nonce ${nonce}`);
          }
          nonces.add(nonce);
        }

        const hash = crypto
          .createHash("sha256")
          .update(sender)
          .update(String(nonce))
          .update(Buffer.from([this.totalSent % 256, (this.totalSent >> 8) % 256]))
          .digest("hex");

        hashes.push(hash);
        this.totalSent++;
      }
      return hashes;
    }

    // Live Mode: POST /transaction/send-multiple
    const payload = txs.map((tx) => tx.toPlainObject());
    const response = await fetch(`${this.apiUrl}/transaction/send-multiple`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`send-multiple failed (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as any;
    const txsHashes = data?.data?.txsHashes ?? {};
    const hashes: string[] = [];

    for (let i = 0; i < txs.length; i++) {
      const hash = txsHashes[String(i)] || txsHashes[i];
      if (!hash) {
        throw new Error(`Missing tx hash for index ${i} in send-multiple response`);
      }
      hashes.push(hash);
    }

    this.totalSent += hashes.length;
    return hashes;
  }

  async getTransaction(txHash: string): Promise<{ status: string }> {
    if (this.mode === "simulation") {
      return { status: "success" };
    }
    const res = await fetch(`${this.apiUrl}/transactions/${txHash}`, {
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`Transaction lookup failed: ${res.statusText}`);
    const data = (await res.json()) as any;
    return { status: data?.data?.transaction?.status ?? "pending" };
  }

  async getAccount(address: Address | string): Promise<{ nonce: number; balance: string }> {
    if (this.mode === "simulation") {
      return { nonce: 0, balance: "5000000000000000000" };
    }
    const bech32 = typeof address === "string" ? address : address.toBech32();
    const res = await fetch(`${this.apiUrl}/accounts/${bech32}`, {
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`Account lookup failed: ${res.statusText}`);
    const data = (await res.json()) as any;
    return {
      nonce: data?.data?.account?.nonce ?? 0,
      balance: data?.data?.account?.balance ?? "0",
    };
  }
}
