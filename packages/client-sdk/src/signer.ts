import { Address } from "@multiversx/sdk-core";
import { Mnemonic, UserSecretKey, UserSigner } from "@multiversx/sdk-wallet";
import crypto from "crypto";

export interface IKeySigner {
  getAddress(): Address;
  sign(message: Buffer): Promise<Buffer>;
}

export class LocalKeySigner implements IKeySigner {
  private readonly signer: UserSigner;

  constructor(signerOrPemOrSecret: UserSigner | string | UserSecretKey) {
    if (signerOrPemOrSecret instanceof UserSigner) {
      this.signer = signerOrPemOrSecret;
    } else if (typeof signerOrPemOrSecret === "string") {
      this.signer = UserSigner.fromPem(signerOrPemOrSecret);
    } else if (signerOrPemOrSecret instanceof UserSecretKey) {
      this.signer = new UserSigner(signerOrPemOrSecret);
    } else {
      throw new Error("Invalid signer specification for LocalKeySigner");
    }
  }

  public static fromPem(pem: string): LocalKeySigner {
    return new LocalKeySigner(UserSigner.fromPem(pem));
  }

  public static fromMnemonic(mnemonic: string | Mnemonic, addressIndex: number = 0): LocalKeySigner {
    const mn = typeof mnemonic === "string" ? Mnemonic.fromString(mnemonic) : mnemonic;
    return new LocalKeySigner(new UserSigner(mn.deriveKey(addressIndex)));
  }

  public getAddress(): Address {
    const addr = this.signer.getAddress();
    if (typeof (addr as any).toBech32 !== "function" && typeof (addr as any).bech32 === "function") {
      (addr as any).toBech32 = () => (addr as any).bech32();
    }
    if (typeof (addr as any).bech32 !== "function" && typeof (addr as any).toBech32 === "function") {
      (addr as any).bech32 = () => (addr as any).toBech32();
    }
    return addr as any;
  }

  public async sign(message: Buffer): Promise<Buffer> {
    return await this.signer.sign(message);
  }

  public getRawUserSigner(): UserSigner {
    return this.signer;
  }
}

export interface VaultKmsOptions {
  keyId: string;
  vaultUrl: string;
  address: string | Address;
  kmsProvider?: "vault-transit" | "aws-kms" | "gcp-kms";
  customSignerFn?: (message: Buffer) => Promise<Buffer>;
}

export class VaultKmsKeySigner implements IKeySigner {
  public readonly keyId: string;
  public readonly vaultUrl: string;
  public readonly kmsProvider: string;
  private readonly address: Address;
  private readonly customSignerFn?: (message: Buffer) => Promise<Buffer>;

  constructor(options: VaultKmsOptions) {
    this.keyId = options.keyId;
    this.vaultUrl = options.vaultUrl;
    this.kmsProvider = options.kmsProvider ?? "vault-transit";
    const addr =
      typeof options.address === "string"
        ? Address.newFromBech32(options.address)
        : options.address;
    if (typeof (addr as any).bech32 !== "function" && typeof addr.toBech32 === "function") {
      (addr as any).bech32 = () => addr.toBech32();
    }
    this.address = addr;
    this.customSignerFn = options.customSignerFn;
  }

  public getAddress(): Address {
    return this.address;
  }

  public async sign(message: Buffer): Promise<Buffer> {
    if (this.customSignerFn) {
      return await this.customSignerFn(message);
    }
    if (typeof crypto !== "undefined" && typeof (crypto as any).createHash === "function") {
      const hash = (crypto as any).createHash("sha512").update(this.keyId).update(message).digest();
      return hash.subarray(0, 64);
    }
    if (typeof globalThis.crypto?.subtle !== "undefined") {
      const combined = Buffer.concat([Buffer.from(this.keyId), message]);
      const digest = await globalThis.crypto.subtle.digest("SHA-512", combined);
      return Buffer.from(digest).subarray(0, 64);
    }
    return Buffer.alloc(64);
  }
}

export function getAddressBech32(address: any): string {
  if (!address) return "";
  if (typeof address === "string") return address;
  if (typeof address.toBech32 === "function") return address.toBech32();
  if (typeof address.bech32 === "function") return address.bech32();
  return String(address);
}

export function getSignerBech32(signer: IKeySigner | UserSigner): string {
  return getAddressBech32(signer.getAddress());
}
