import { describe, it, expect } from "vitest";
import { Address } from "@multiversx/sdk-core";
import { Mnemonic, UserSigner } from "@multiversx/sdk-wallet";
import { LocalKeySigner, VaultKmsKeySigner } from "../../src/services/key_signer.js";
import { RelayerPoolManager } from "../../src/services/relayer_pool.js";
import { PipelinedRelayerPool } from "../../src/services/pipelined_relayer_pool.js";

describe("KeySigner Abstraction", () => {
  const mnemonicStr =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";
  const mnemonic = Mnemonic.fromString(mnemonicStr);
  const secretKey = mnemonic.deriveKey(0);
  const userSigner = new UserSigner(secretKey);
  const userAddress = userSigner.getAddress();

  it("should create LocalKeySigner from UserSigner and sign messages correctly", async () => {
    const signer = new LocalKeySigner(userSigner);
    expect(signer.getAddress().bech32()).toBe(userAddress.bech32());

    const message = Buffer.from("test transaction payload to sign");
    const sig = await signer.sign(message);
    expect(sig).toBeInstanceOf(Buffer);
    expect(sig.length).toBe(64);

    const expectedSig = await userSigner.sign(message);
    expect(sig.toString("hex")).toBe(expectedSig.toString("hex"));
  });

  it("should create LocalKeySigner from mnemonic helper", async () => {
    const signer = LocalKeySigner.fromMnemonic(mnemonicStr, 0);
    expect(signer.getAddress().bech32()).toBe(userAddress.bech32());
    const sig = await signer.sign(Buffer.from("hello"));
    expect(sig.length).toBe(64);
  });

  it("should create VaultKmsKeySigner with cloud provider configuration", async () => {
    const kmsSigner = new VaultKmsKeySigner({
      keyId: "arn:aws:kms:eu-central-1:123456789012:key/mvx-relayer-shard-0",
      address: userAddress.bech32(),
      kmsProvider: "aws-kms",
      vaultUrl: "https://vault.internal.net:8200",
    });

    expect(kmsSigner.getAddress().bech32()).toBe(userAddress.bech32());
    expect(kmsSigner.keyId).toContain("mvx-relayer-shard-0");
    expect(kmsSigner.kmsProvider).toBe("aws-kms");

    const message = Buffer.from("gasless relayed tx bytes");
    const sig = await kmsSigner.sign(message);
    expect(sig).toBeInstanceOf(Buffer);
    expect(sig.length).toBe(64);
  });

  it("should support custom signing function in VaultKmsKeySigner", async () => {
    let called = false;
    const customKms = new VaultKmsKeySigner({
      keyId: "vault-transit-key-1",
      address: userAddress,
      customSignerFn: async (msg) => {
        called = true;
        return Buffer.alloc(64, 0xaa);
      },
    });

    const sig = await customKms.sign(Buffer.from("data"));
    expect(called).toBe(true);
    expect(sig.toString("hex")).toBe(Buffer.alloc(64, 0xaa).toString("hex"));
  });

  it("should seamlessly integrate with RelayerPoolManager and PipelinedRelayerPool", async () => {
    const localSigner = new LocalKeySigner(userSigner);
    const pool = new RelayerPoolManager();
    const shard = pool.registerRelayerAuto(localSigner);

    expect(pool.hasShard(shard)).toBe(true);
    const retrieved = pool.getRelayerForShard(shard);
    expect(retrieved.getAddress().bech32()).toBe(userAddress.bech32());

    const sig = await retrieved.sign(Buffer.from("relayed message"));
    expect(sig.length).toBe(64);

    const pipelinedPool = new PipelinedRelayerPool();
    pipelinedPool.registerRelayer(shard, localSigner);
    const pipeRelayer = pipelinedPool.getRelayerForShard(shard);
    expect(pipeRelayer.getAddress().bech32()).toBe(userAddress.bech32());
  });
});
