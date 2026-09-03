import { describe, it, expect } from "vitest";
import { Address, Transaction } from "@multiversx/sdk-core";
import { BatchNetworkProvider } from "../../src/services/batch_network_provider.js";

describe("BatchNetworkProvider (/transaction/send-multiple & High-Throughput Engine)", () => {
  const dummyAddress = Address.newFromBech32(
    "erd1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq6gq4hu"
  );

  it("should batch process 100 transactions and return unique on-chain hashes", async () => {
    const provider = new BatchNetworkProvider({ mode: "simulation" });
    const txs: Transaction[] = [];

    for (let i = 0; i < 100; i++) {
      txs.push(
        new Transaction({
          nonce: BigInt(i + 1),
          value: 0n,
          sender: dummyAddress,
          receiver: dummyAddress,
          gasLimit: 500000n,
          gasPrice: 1000000000n,
          data: Buffer.from(`ESDTTransfer@555344432d633736663166@0${i}`),
          chainID: "1",
        })
      );
    }

    const hashes = await provider.sendTransactions(txs);
    expect(hashes).toHaveLength(100);
    expect(new Set(hashes).size).toBe(100);
    expect(provider.getTotalSentCount()).toBe(100);
  });

  it("should enforce sequential nonces per relayer in simulation mode and detect collisions", async () => {
    const provider = new BatchNetworkProvider({ mode: "simulation", strictNonceCheck: true });
    
    // Send nonce 1
    const tx1 = new Transaction({
      nonce: 1n,
      value: 0n,
      sender: dummyAddress,
      receiver: dummyAddress,
      gasLimit: 500000n,
      gasPrice: 1000000000n,
      chainID: "1",
    });

    // Send duplicate nonce 1 (collision)
    const tx1Collision = new Transaction({
      nonce: 1n,
      value: 0n,
      sender: dummyAddress,
      receiver: dummyAddress,
      gasLimit: 500000n,
      gasPrice: 1000000000n,
      chainID: "1",
    });

    await expect(provider.sendTransactions([tx1, tx1Collision])).rejects.toThrow(/nonce collision/i);
  });
});
