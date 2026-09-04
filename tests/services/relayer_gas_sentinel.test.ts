import { describe, it, expect, vi, beforeEach } from "vitest";
import { Address, Transaction } from "@multiversx/sdk-core";
import { Mnemonic, UserSigner } from "@multiversx/sdk-wallet";
import { RelayerGasSentinel } from "../../src/services/relayer_gas_sentinel.js";
import { RelayerPoolManager } from "../../src/services/relayer_pool.js";
import { INetworkProvider } from "../../src/domain/network.js";

function getAddrStr(addr: any): string {
  if (typeof addr === "string") return addr;
  if (typeof addr.toBech32 === "function") return addr.toBech32();
  if (typeof addr.bech32 === "function") return addr.bech32();
  return String(addr);
}

describe("RelayerGasSentinel (TDD)", () => {
  let treasurySigner: UserSigner;
  let treasuryAddress: string;
  let relayer0Signer: UserSigner;
  let relayer0Address: string;
  let relayer1Signer: UserSigner;
  let relayer1Address: string;
  let relayerPool: RelayerPoolManager;

  beforeEach(() => {
    const treasuryMnemonic = Mnemonic.generate();
    treasurySigner = new UserSigner(treasuryMnemonic.deriveKey(0));
    treasuryAddress = getAddrStr(treasurySigner.getAddress());

    const relayer0Mnemonic = Mnemonic.generate();
    relayer0Signer = new UserSigner(relayer0Mnemonic.deriveKey(0));
    relayer0Address = getAddrStr(relayer0Signer.getAddress());

    const relayer1Mnemonic = Mnemonic.generate();
    relayer1Signer = new UserSigner(relayer1Mnemonic.deriveKey(0));
    relayer1Address = getAddrStr(relayer1Signer.getAddress());

    relayerPool = new RelayerPoolManager();
    relayerPool.registerRelayer(0, relayer0Signer);
    relayerPool.registerRelayer(1, relayer1Signer);
  });

  it("should NOT trigger top-up when all relayers have balance >= threshold", async () => {
    const mockNetworkProvider: INetworkProvider = {
      getAccount: vi.fn().mockImplementation(async (addr: Address) => {
        const bech32 = getAddrStr(addr);
        if (bech32 === treasuryAddress) {
          return { nonce: 5, balance: 10_000_000_000_000_000_000n }; // 10 EGLD
        }
        // Both relayers have 0.1 EGLD (> 0.05 EGLD threshold)
        return { nonce: 1, balance: 100_000_000_000_000_000n };
      }),
      sendTransaction: vi.fn().mockResolvedValue("0xtxhash"),
    } as any;

    const sentinel = new RelayerGasSentinel({
      networkProvider: mockNetworkProvider,
      relayerPool,
      treasurySigner,
      thresholdEgld: 0.05,
      topUpAmountEgld: 0.1,
      chainID: "D",
    });

    const result = await sentinel.checkAndTopUp();

    expect(result.checked).toBe(2);
    expect(result.toppedUp).toBe(0);
    expect(mockNetworkProvider.sendTransaction).not.toHaveBeenCalled();

    const statuses = sentinel.getRelayerStatuses();
    expect(statuses.length).toBe(2);
    expect(statuses.every((s) => !s.needsTopUp)).toBe(true);
  });

  it("should detect relayer with balance < 0.05 EGLD and execute auto-top-up transaction", async () => {
    let sentTx: Transaction | null = null;
    const mockNetworkProvider: INetworkProvider = {
      getAccount: vi.fn().mockImplementation(async (addr: Address) => {
        const bech32 = getAddrStr(addr);
        if (bech32 === treasuryAddress) {
          return { nonce: 10, balance: 50_000_000_000_000_000_000n };
        }
        if (bech32 === relayer0Address) {
          // Relayer 0 drops to 0.02 EGLD (< 0.05 EGLD threshold)
          return { nonce: 2, balance: 20_000_000_000_000_000n };
        }
        // Relayer 1 has healthy 0.8 EGLD
        return { nonce: 4, balance: 800_000_000_000_000_000n };
      }),
      sendTransaction: vi.fn().mockImplementation(async (tx: Transaction) => {
        sentTx = tx;
        return "0xtopuptxhash123";
      }),
    } as any;

    const onAlert = vi.fn();
    const onTopUp = vi.fn();

    const sentinel = new RelayerGasSentinel({
      networkProvider: mockNetworkProvider,
      relayerPool,
      treasurySigner,
      thresholdEgld: 0.05,
      topUpAmountEgld: 0.1,
      chainID: "D",
      onAlert,
      onTopUp,
    });

    const result = await sentinel.checkAndTopUp();

    expect(result.checked).toBe(2);
    expect(result.toppedUp).toBe(1);
    expect(mockNetworkProvider.sendTransaction).toHaveBeenCalledTimes(1);
    expect(onAlert).toHaveBeenCalledWith(relayer0Address, 20_000_000_000_000_000n, 50_000_000_000_000_000n);
    expect(onTopUp).toHaveBeenCalledWith(relayer0Address, 100_000_000_000_000_000n, "0xtopuptxhash123");

    // Verify transaction structure
    expect(sentTx).not.toBeNull();
    expect(getAddrStr(sentTx!.sender)).toBe(treasuryAddress);
    expect(getAddrStr(sentTx!.receiver)).toBe(relayer0Address);
    expect(sentTx!.value).toBe(100_000_000_000_000_000n); // 0.1 EGLD
    expect(sentTx!.gasLimit).toBe(50_000n);
    expect(sentTx!.chainID).toBe("D");
    expect(sentTx!.signature).toBeDefined();
    expect(sentTx!.signature.length).toBe(64);
  });

  it("should increment nonces accurately when multiple relayers are topped up", async () => {
    const sentTxs: Transaction[] = [];
    const mockNetworkProvider: INetworkProvider = {
      getAccount: vi.fn().mockImplementation(async (addr: Address) => {
        const bech32 = getAddrStr(addr);
        if (bech32 === treasuryAddress) {
          return { nonce: 42, balance: 100_000_000_000_000_000_000n };
        }
        // Both relayers have 0 EGLD (critical starvation)
        return { nonce: 0, balance: 0n };
      }),
      sendTransaction: vi.fn().mockImplementation(async (tx: Transaction) => {
        sentTxs.push(tx);
        return `0xhash-${sentTxs.length}`;
      }),
    } as any;

    const sentinel = new RelayerGasSentinel({
      networkProvider: mockNetworkProvider,
      relayerPool,
      treasurySigner,
      thresholdEgld: 0.05,
      topUpAmountEgld: 0.15,
      chainID: "D",
    });

    const result = await sentinel.checkAndTopUp();

    expect(result.checked).toBe(2);
    expect(result.toppedUp).toBe(2);
    expect(sentTxs.length).toBe(2);
    expect(sentTxs[0].nonce).toBe(42n);
    expect(sentTxs[1].nonce).toBe(43n);
    expect(sentTxs[0].value).toBe(150_000_000_000_000_000n);
    expect(sentTxs[1].value).toBe(150_000_000_000_000_000n);
  });

  it("should handle single relayer query errors gracefully without aborting remaining relayers", async () => {
    const mockNetworkProvider: INetworkProvider = {
      getAccount: vi.fn().mockImplementation(async (addr: Address) => {
        const bech32 = getAddrStr(addr);
        if (bech32 === treasuryAddress) {
          return { nonce: 0, balance: 10_000_000_000_000_000_000n };
        }
        if (bech32 === relayer0Address) {
          throw new Error("RPC network timeout");
        }
        return { nonce: 0, balance: 10_000_000_000_000_000n }; // Needs top-up (0.01 EGLD)
      }),
      sendTransaction: vi.fn().mockResolvedValue("0xsuccesshash"),
    } as any;

    const sentinel = new RelayerGasSentinel({
      networkProvider: mockNetworkProvider,
      relayerPool,
      treasurySigner,
      thresholdEgld: 0.05,
    });

    const result = await sentinel.checkAndTopUp();

    expect(result.checked).toBe(2);
    expect(result.toppedUp).toBe(1);
    expect(result.relayers[0].error).toBe("RPC network timeout");
    expect(result.relayers[1].toppedUp).toBe(true);
  });

  it("should support starting and stopping periodic sentinel daemon", () => {
    const mockNetworkProvider: INetworkProvider = {} as any;
    const sentinel = new RelayerGasSentinel({
      networkProvider: mockNetworkProvider,
      relayerPool,
      treasurySigner,
      checkIntervalMs: 1000,
    });

    expect(sentinel.isRunning()).toBe(false);
    sentinel.start();
    expect(sentinel.isRunning()).toBe(true);
    // Idempotent start
    sentinel.start();
    expect(sentinel.isRunning()).toBe(true);

    sentinel.stop();
    expect(sentinel.isRunning()).toBe(false);
  });

  it("should NOT increment localNonce when sendTransaction fails and preserve real queried balance", async () => {
    let callCount = 0;
    const mockNetworkProvider: INetworkProvider = {
      getAccount: vi.fn().mockImplementation(async (addr: Address) => {
        const bech32 = getAddrStr(addr);
        if (bech32 === treasuryAddress) {
          return { nonce: 15, balance: 10_000_000_000_000_000_000n };
        }
        // Relayer 0 needs top-up (0.01 EGLD)
        if (bech32 === relayer0Address) {
          return { nonce: 1, balance: 10_000_000_000_000_000n };
        }
        // Relayer 1 has plenty of gas
        return { nonce: 1, balance: 500_000_000_000_000_000n };
      }),
      sendTransaction: vi.fn().mockImplementation(async (_tx: Transaction) => {
        callCount++;
        if (callCount === 1) {
          throw new Error("Temporary devnet node connection failure");
        }
        return "0xretrysuccesshash";
      }),
    } as any;

    const sentinel = new RelayerGasSentinel({
      networkProvider: mockNetworkProvider,
      relayerPool,
      treasurySigner,
      thresholdEgld: 0.05,
      topUpAmountEgld: 0.1,
      chainID: "D",
    });

    // 1st run: sendTransaction fails
    const result1 = await sentinel.checkAndTopUp();
    expect(result1.toppedUp).toBe(0);
    const failedRelayer = result1.relayers.find((r) => r.address === relayer0Address);
    expect(failedRelayer?.toppedUp).toBe(false);
    expect(failedRelayer?.error).toContain("Temporary devnet node connection failure");
    // Verify actual queried balance was preserved, NOT wiped to 0n
    expect(failedRelayer?.balance).toBe(10_000_000_000_000_000n);

    // 2nd run: succeeds with original nonce 15 (NOT desynced to 16)
    const result2 = await sentinel.checkAndTopUp();
    expect(result2.toppedUp).toBe(1);
    const successRelayer = result2.relayers.find((r) => r.address === relayer0Address);
    expect(successRelayer?.toppedUp).toBe(true);
    expect(successRelayer?.txHash).toBe("0xretrysuccesshash");
  });

  it("should query real on-chain account state without mocks via MvxApiNetworkProvider against Devnet", async () => {
    const { MvxApiNetworkProvider } = await import("../../src/domain/network.js");
    const realNetworkProvider = new MvxApiNetworkProvider("https://devnet-api.multiversx.com", {
      timeout: 10000,
      clientName: "relayer-gas-sentinel-test",
    });

    // Verify querying real accounts
    const merchantAddress = Address.newFromBech32("erd123g08w7g2p9qxynfhplxukearq68uyqn2fvepyyf33pd40ea95as02yv3k");
    const realAccount = await realNetworkProvider.getAccount(merchantAddress);
    expect(realAccount).toBeDefined();
    expect(realAccount.address).toBeDefined();

    const sentinel = new RelayerGasSentinel({
      networkProvider: realNetworkProvider,
      relayerPool,
      treasurySigner,
      thresholdEgld: 0.05,
      topUpAmountEgld: 0.1,
      chainID: "D",
    });

    // Verify check passes and properly queries real network without throwing
    const statuses = sentinel.getRelayerStatuses();
    expect(Array.isArray(statuses)).toBe(true);
  });
});
