import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  MultiversxX402Client,
  LocalKeySigner,
  VaultKmsKeySigner,
  SpendLimitError,
  PaymentRequirements,
  getSignerBech32,
} from "../src/index.js";
import { Mnemonic, UserSigner } from "@multiversx/sdk-wallet";

describe("@sasurobert/multiversx-x402 Client SDK", () => {
  const testMnemonic =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";
  let signer: LocalKeySigner;

  beforeEach(() => {
    signer = LocalKeySigner.fromMnemonic(testMnemonic, 0);
  });

  it("should initialize client and derive valid MultiversX bech32 address", () => {
    const client = new MultiversxX402Client({
      signer,
      network: "multiversx:D",
      tokenIdentifier: "USDC-350c4e",
    });

    const addr = client.getWalletAddress();
    expect(addr).toMatch(/^erd1[a-z0-9]{58}$/);
    expect(client.network).toBe("multiversx:D");
    expect(client.tokenIdentifier).toBe("USDC-350c4e");
  });

  it("should initialize client from PEM string", () => {
    const mn = Mnemonic.fromString(testMnemonic);
    const sk = mn.deriveKey(0);
    const pk = sk.generatePublicKey();
    const combinedHex = sk.hex() + pk.hex();
    const b64 = Buffer.from(combinedHex).toString("base64");
    const pemText = `-----BEGIN PRIVATE KEY for ${pk.toAddress().bech32()}-----\n${b64}\n-----END PRIVATE KEY-----`;

    const client = MultiversxX402Client.fromPem(pemText, {
      network: "multiversx:D",
    });

    expect(client.getWalletAddress()).toMatch(/^erd1[a-z0-9]{58}$/);
  });

  it("should cryptographically build signed x402 payment payload", async () => {
    const client = new MultiversxX402Client({
      signer,
      network: "multiversx:D",
      tokenIdentifier: "USDC-350c4e",
      maxCostPerCallUsd: 0.10,
    });

    const reqs: PaymentRequirements = {
      scheme: "exact",
      network: "multiversx:D",
      amount: "5000",
      asset: "USDC-350c4e",
      payTo: "erd1qqqqqqqqqqqqqpgqvj462tzng7nz4muwd89lz76cxdc03hd2dnyqus85yp",
      maxTimeoutSeconds: 300,
    };

    const b64 = await client.buildSignedX402Payment(reqs);
    expect(b64).toBeDefined();

    const json = JSON.parse(Buffer.from(b64, "base64").toString("utf-8"));
    expect(json.x402Version).toBe(2);
    expect(json.network).toBe("multiversx:D");
    expect(json.payload.sender).toBe(client.getWalletAddress());
    expect(json.payload.receiver).toBe(reqs.payTo);
    expect(json.payload.signature).toMatch(/^[0-9a-f]{128}$/);
  });

  it("should enforce maxCostPerCall limit", async () => {
    const client = new MultiversxX402Client({
      signer,
      network: "multiversx:D",
      maxCostPerCallUsd: 0.01, // $0.01 max
    });

    const expensiveReqs: PaymentRequirements = {
      scheme: "exact",
      network: "multiversx:D",
      amount: "50000", // $0.05
      asset: "USDC-350c4e",
      payTo: "erd1qqqqqqqqqqqqqpgqvj462tzng7nz4muwd89lz76cxdc03hd2dnyqus85yp",
      maxTimeoutSeconds: 300,
    };

    await expect(client.buildSignedX402Payment(expensiveReqs)).rejects.toThrow(
      SpendLimitError
    );
  });

  it("should enforce maxTotalBudgetUsd limit across multiple calls", async () => {
    const client = new MultiversxX402Client({
      signer,
      network: "multiversx:D",
      maxCostPerCallUsd: 1.0,
      maxTotalBudgetUsd: 0.008, // $0.008 budget
    });

    const reqs: PaymentRequirements = {
      scheme: "exact",
      network: "multiversx:D",
      amount: "5000", // $0.005
      asset: "USDC-350c4e",
      payTo: "erd1qqqqqqqqqqqqqpgqvj462tzng7nz4muwd89lz76cxdc03hd2dnyqus85yp",
      maxTimeoutSeconds: 300,
    };

    // First call: $0.005 (total spent: $0.005 <= $0.008) -> ok
    await client.buildSignedX402Payment(reqs);
    expect(client.totalSpentUsd).toBe(0.005);

    // Second call: $0.005 (total spent would be $0.010 > $0.008) -> throws
    await expect(client.buildSignedX402Payment(reqs)).rejects.toThrow(SpendLimitError);
  });

  it("should support VaultKmsKeySigner with customSignerFn", async () => {
    const dummyAddr = "erd1ka0yrspygvjtktyzxu58ufn0kujkqgx4gq2ch5ev2aqjcem9jcqqkntrmv";
    const customSigner = vi.fn().mockResolvedValue(Buffer.alloc(64, 0xaa));

    const kmsSigner = new VaultKmsKeySigner({
      keyId: "projects/mvx/cryptoKeys/relayer-1",
      address: dummyAddr,
      customSignerFn: customSigner,
    });

    expect(getSignerBech32(kmsSigner)).toBe(dummyAddr);
    const sig = await kmsSigner.sign(Buffer.from("test-message"));
    expect(sig.length).toBe(64);
    expect(customSigner).toHaveBeenCalled();
  });
});
