import { Address, Transaction, TransactionComputer } from "@multiversx/sdk-core";
import { UserSigner } from "@multiversx/sdk-wallet";
import { INetworkProvider } from "../domain/network.js";
import { RelayerPoolManager } from "./relayer_pool.js";

export interface RelayerGasSentinelConfig {
  networkProvider: INetworkProvider;
  relayerPool: RelayerPoolManager;
  treasurySigner: UserSigner;
  thresholdEgld?: number | bigint;
  topUpAmountEgld?: number | bigint;
  chainID?: string;
  checkIntervalMs?: number;
  onTopUp?: (relayerAddress: string, amount: bigint, txHash: string) => void;
  onAlert?: (relayerAddress: string, balance: bigint, threshold: bigint) => void;
}

export interface RelayerBalanceStatus {
  address: string;
  shard: number;
  balance: bigint;
  balanceEgld: string;
  needsTopUp: boolean;
  lastChecked: number;
}

export interface SentinelCheckResult {
  checked: number;
  toppedUp: number;
  threshold: bigint;
  relayers: Array<{
    address: string;
    shard: number;
    balance: bigint;
    balanceEgld: string;
    toppedUp: boolean;
    txHash?: string;
    error?: string;
  }>;
}

function parseEgldValue(val?: number | bigint, defaultVal: bigint = 50_000_000_000_000_000n): bigint {
  if (val === undefined) return defaultVal;
  if (typeof val === "bigint") return val;
  return BigInt(Math.floor(val * 1e18));
}

function formatEgld(wei: bigint): string {
  const whole = wei / 1_000_000_000_000_000_000n;
  const rem = wei % 1_000_000_000_000_000_000n;
  const remStr = rem.toString().padStart(18, "0").slice(0, 4);
  return `${whole}.${remStr} EGLD`;
}

/**
 * Autonomous Relayer Gas Sentinel & Auto-Top-Up Engine for MultiversX Devnet/Mainnet.
 * Continuously monitors relayer balances across all shards and automatically executes
 * gas replenishment transfers whenever any relayer falls below threshold (< 0.05 EGLD).
 */
export class RelayerGasSentinel {
  private readonly networkProvider: INetworkProvider;
  private readonly relayerPool: RelayerPoolManager;
  private readonly treasurySigner: UserSigner;
  private readonly threshold: bigint;
  private readonly topUpAmount: bigint;
  private readonly chainID: string;
  private readonly checkIntervalMs: number;
  private readonly tc: TransactionComputer;

  private timer: ReturnType<typeof setInterval> | null = null;
  private localNonce = 0;
  private isChecking = false;
  private latestStatuses = new Map<string, RelayerBalanceStatus>();

  private readonly onTopUp?: (relayerAddress: string, amount: bigint, txHash: string) => void;
  private readonly onAlert?: (relayerAddress: string, balance: bigint, threshold: bigint) => void;

  constructor(config: RelayerGasSentinelConfig) {
    this.networkProvider = config.networkProvider;
    this.relayerPool = config.relayerPool;
    this.treasurySigner = config.treasurySigner;
    // Default threshold: 0.05 EGLD (50,000,000,000,000,000 wei)
    this.threshold = parseEgldValue(config.thresholdEgld, 50_000_000_000_000_000n);
    // Default top-up: 0.1 EGLD (100,000,000,000,000,000 wei)
    this.topUpAmount = parseEgldValue(config.topUpAmountEgld, 100_000_000_000_000_000n);
    this.chainID = config.chainID ?? "D";
    this.checkIntervalMs = config.checkIntervalMs ?? 60_000;
    this.tc = new TransactionComputer();
    this.onTopUp = config.onTopUp;
    this.onAlert = config.onAlert;
  }

  public getThreshold(): bigint {
    return this.threshold;
  }

  public getTopUpAmount(): bigint {
    return this.topUpAmount;
  }

  public getChainID(): string {
    return this.chainID;
  }

  public isRunning(): boolean {
    return this.timer !== null;
  }

  public start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      this.checkAndTopUp().catch(() => {});
    }, this.checkIntervalMs);

    if (this.timer.unref) {
      this.timer.unref();
    }
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public getRelayerStatuses(): RelayerBalanceStatus[] {
    return Array.from(this.latestStatuses.values());
  }

  /**
   * Queries real on-chain balance for all configured relayers and executes auto-top-up
   * transactions for any relayer whose balance is below the configured threshold.
   */
  public async checkAndTopUp(): Promise<SentinelCheckResult> {
    if (this.isChecking) {
      return {
        checked: 0,
        toppedUp: 0,
        threshold: this.threshold,
        relayers: [],
      };
    }

    this.isChecking = true;
    const results: SentinelCheckResult["relayers"] = [];
    let checked = 0;
    let toppedUp = 0;

    try {
      // Sync treasury nonce
      const treasuryRaw = this.treasurySigner.getAddress();
      const treasuryBech32 =
        typeof treasuryRaw === "string"
          ? treasuryRaw
          : typeof (treasuryRaw as any).toBech32 === "function"
            ? (treasuryRaw as any).toBech32()
            : (treasuryRaw as any).bech32();
      const treasuryAddress = Address.newFromBech32(treasuryBech32);
      const treasuryAccount = (await this.networkProvider.getAccount(treasuryAddress)) as any;
      if (treasuryAccount && typeof treasuryAccount.nonce === "number") {
        this.localNonce = Math.max(this.localNonce, treasuryAccount.nonce);
      }

      // Collect all configured relayers
      const relayerMap = this.relayerPool.getAllRelayerAddressesMulti();
      const uniqueRelayers: Array<{ address: string; shard: number }> = [];
      const seen = new Set<string>();

      for (const [shardStr, addrs] of Object.entries(relayerMap)) {
        const shard = Number(shardStr);
        for (const addr of addrs) {
          if (!seen.has(addr)) {
            seen.add(addr);
            uniqueRelayers.push({ address: addr, shard });
          }
        }
      }

      for (const relayer of uniqueRelayers) {
        checked++;
        let balance = 0n;
        let balanceEgld = "0 EGLD";
        try {
          const relayerAddressObj = Address.newFromBech32(relayer.address);
          const account = (await this.networkProvider.getAccount(relayerAddressObj)) as any;
          const balanceStr = account?.balance?.toString() ?? "0";
          balance = BigInt(balanceStr);
          balanceEgld = formatEgld(balance);
          const needsTopUp = balance < this.threshold;

          this.latestStatuses.set(relayer.address, {
            address: relayer.address,
            shard: relayer.shard,
            balance,
            balanceEgld,
            needsTopUp,
            lastChecked: Date.now(),
          });

          if (needsTopUp) {
            if (this.onAlert) {
              this.onAlert(relayer.address, balance, this.threshold);
            }

            const txHash = await this.executeTopUp(relayer.address);
            toppedUp++;
            if (this.onTopUp) {
              this.onTopUp(relayer.address, this.topUpAmount, txHash);
            }

            results.push({
              address: relayer.address,
              shard: relayer.shard,
              balance,
              balanceEgld,
              toppedUp: true,
              txHash,
            });
          } else {
            results.push({
              address: relayer.address,
              shard: relayer.shard,
              balance,
              balanceEgld,
              toppedUp: false,
            });
          }
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          results.push({
            address: relayer.address,
            shard: relayer.shard,
            balance,
            balanceEgld,
            toppedUp: false,
            error: errMsg,
          });
        }
      }
    } finally {
      this.isChecking = false;
    }

    return {
      checked,
      toppedUp,
      threshold: this.threshold,
      relayers: results,
    };
  }

  private async executeTopUp(receiverAddress: string): Promise<string> {
    const treasuryRaw = this.treasurySigner.getAddress();
    const treasuryBech32 =
      typeof treasuryRaw === "string"
        ? treasuryRaw
        : typeof (treasuryRaw as any).toBech32 === "function"
          ? (treasuryRaw as any).toBech32()
          : (treasuryRaw as any).bech32();
    const sender = Address.newFromBech32(treasuryBech32);
    const receiver = Address.newFromBech32(receiverAddress);

    const tx = new Transaction({
      nonce: BigInt(this.localNonce),
      value: this.topUpAmount,
      sender,
      receiver,
      gasPrice: 1_000_000_000n,
      gasLimit: 50_000n,
      data: Buffer.from(""),
      chainID: this.chainID,
      version: 1,
      options: 0,
    });

    const bytes = this.tc.computeBytesForSigning(tx);
    const signature = await this.treasurySigner.sign(bytes);
    tx.signature = signature;

    const txHash = await this.networkProvider.sendTransaction(tx);
    this.localNonce++;
    return txHash;
  }
}
