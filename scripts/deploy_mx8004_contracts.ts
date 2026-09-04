import fs from "fs";
import path from "path";
import {
  Address,
  AddressComputer,
  SmartContractTransactionsFactory,
  TransactionsFactoryConfig,
  TransactionComputer,
} from "@multiversx/sdk-core";
import { UserSigner } from "@multiversx/sdk-wallet";
import { ApiNetworkProvider } from "@multiversx/sdk-network-providers";

const DEVNET_API = process.env.MULTIVERSX_API_URL || "https://devnet-api.multiversx.com";
const CHAIN_ID = "D";

interface DeployResult {
  name: string;
  txHash: string;
  contractAddress: string;
  explorerUrl: string;
}

async function waitForTx(provider: ApiNetworkProvider, txHash: string, timeoutMs = 90000): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const tx = await provider.getTransaction(txHash);
      if (tx.status.isExecuted() || tx.status.isSuccessful()) {
        return tx;
      }
      if (tx.status.isFailed() || tx.status.isInvalid()) {
        throw new Error(`Transaction ${txHash} failed with status: ${tx.status.status}`);
      }
    } catch (err: any) {
      if (err.message?.includes("failed")) throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(`Timeout waiting for transaction ${txHash}`);
}

async function deployOneContract(
  provider: ApiNetworkProvider,
  factory: SmartContractTransactionsFactory,
  signer: UserSigner,
  relayerAddr: Address,
  name: string,
  wasmPath: string,
  args: Buffer[] = [],
  gasLimit = 65000000n
): Promise<DeployResult> {
  console.log(`\n------------------------------------------------------------`);
  console.log(`Deploying ${name}...`);
  console.log(`WASM File: ${wasmPath}`);

  if (!fs.existsSync(wasmPath)) {
    throw new Error(`WASM file not found at: ${wasmPath}`);
  }

  const wasmBytecode = fs.readFileSync(wasmPath);
  console.log(`WASM Size: ${wasmBytecode.length} bytes`);

  const account = await provider.getAccount({ bech32: () => relayerAddr.toBech32() });
  const nonce = account.nonce;
  console.log(`Deployer Nonce: ${nonce}`);

  const addressComputer = new AddressComputer();
  const expectedContractAddr = addressComputer.computeContractAddress(relayerAddr, BigInt(nonce));
  const expectedBech32 = expectedContractAddr.toBech32();
  console.log(`Expected Contract Address: ${expectedBech32}`);

  const tx = await factory.createTransactionForDeploy(relayerAddr, {
    bytecode: wasmBytecode,
    gasLimit,
    arguments: args,
    isUpgradeable: true,
    isReadable: true,
    isPayable: true,
    isPayableBySmartContract: true,
  });

  tx.nonce = BigInt(nonce);

  const computer = new TransactionComputer();
  const bytesToSign = computer.computeBytesForSigning(tx);
  tx.signature = await signer.sign(bytesToSign);

  const txHash = await provider.sendTransaction(tx);
  console.log(`Deploy Transaction Sent! TxHash: ${txHash}`);
  console.log(`Explorer: https://devnet-explorer.multiversx.com/transactions/${txHash}`);

  console.log(`Waiting for block finalization...`);
  const finishedTx = await waitForTx(provider, txHash);
  console.log(`Transaction Executed! Status: ${finishedTx.status.status}`);

  // Query contract account to confirm it exists
  const contractAccount = await provider.getAccount({ bech32: () => expectedBech32 });
  console.log(`Confirmed on-chain contract codeHash: ${contractAccount.codeHash ? "OK" : "EMPTY"}`);

  return {
    name,
    txHash,
    contractAddress: expectedBech32,
    explorerUrl: `https://devnet-explorer.multiversx.com/accounts/${expectedBech32}`,
  };
}

async function main() {
  console.log(`============================================================`);
  console.log(`   Deploying MX-8004 Smart Contracts to MultiversX Devnet   `);
  console.log(`============================================================`);

  const provider = new ApiNetworkProvider(DEVNET_API, { clientName: "mx8004-deployer" });
  const factory = new SmartContractTransactionsFactory({
    config: new TransactionsFactoryConfig({ chainID: CHAIN_ID }),
  });

  const toNetAddr = (addrStr: string) => ({ bech32: () => addrStr });

  const pemPath = path.resolve(process.cwd(), "wallets/relayer_shard0.pem");
  const pem = fs.readFileSync(pemPath, "utf-8");
  const signer = UserSigner.fromPem(pem);
  const relayerBech32 = signer.getAddress().bech32();
  const relayerAddr = Address.newFromBech32(relayerBech32);
  console.log(`Deployer Account: ${relayerBech32}`);

  const relayerAccount = await provider.getAccount(toNetAddr(relayerBech32));
  console.log(`Deployer Balance: ${(Number(relayerAccount.balance) / 1e18).toFixed(4)} EGLD`);

  const mx8004Dir = path.resolve(process.cwd(), "../mx-8004");
  const wasmDir = path.resolve(mx8004Dir, "output");

  const results: Record<string, DeployResult> = {};

  // 1. Deploy Identity Registry
  const identityWasm = path.resolve(wasmDir, "identity-registry.wasm");
  const identityResult = await deployOneContract(
    provider,
    factory,
    signer,
    relayerAddr,
    "IdentityRegistry",
    identityWasm,
    [],
    70000000n
  );
  results["IdentityRegistry"] = identityResult;

  // 2. Deploy Validation Registry (arg: identity_registry_address)
  const validationWasm = path.resolve(wasmDir, "validation-registry.wasm");
  const identityBuffer = Address.newFromBech32(identityResult.contractAddress).getPublicKey();
  const validationResult = await deployOneContract(
    provider,
    factory,
    signer,
    relayerAddr,
    "ValidationRegistry",
    validationWasm,
    [identityBuffer],
    65000000n
  );
  results["ValidationRegistry"] = validationResult;

  // 3. Deploy Reputation Registry (args: validation_contract_address, identity_contract_address)
  const reputationWasm = path.resolve(wasmDir, "reputation-registry.wasm");
  const validationBuffer = Address.newFromBech32(validationResult.contractAddress).getPublicKey();
  const reputationResult = await deployOneContract(
    provider,
    factory,
    signer,
    relayerAddr,
    "ReputationRegistry",
    reputationWasm,
    [validationBuffer, identityBuffer],
    60000000n
  );
  results["ReputationRegistry"] = reputationResult;

  // 4. Deploy Escrow (args: validation_contract_address, identity_contract_address)
  const escrowWasm = path.resolve(wasmDir, "escrow.wasm");
  const escrowResult = await deployOneContract(
    provider,
    factory,
    signer,
    relayerAddr,
    "Escrow",
    escrowWasm,
    [validationBuffer, identityBuffer],
    60000000n
  );
  results["Escrow"] = escrowResult;

  console.log(`\n============================================================`);
  console.log(`   ALL 4 CONTRACTS DEPLOYED SUCCESSFULLY ON DEVNET!        `);
  console.log(`============================================================`);
  console.table(
    Object.values(results).map((r) => ({
      Contract: r.name,
      Address: r.contractAddress,
      TxHash: r.txHash.substring(0, 16) + "...",
    }))
  );

  // Write addresses to JSON
  const deployedPath = path.resolve(process.cwd(), "deployed_mx8004.json");
  fs.writeFileSync(deployedPath, JSON.stringify(results, null, 2));
  console.log(`Saved deployment info to ${deployedPath}`);

  // Update .env.local with deployed contract addresses
  const envLocalPath = path.resolve(process.cwd(), ".env.local");
  let envLocal = fs.existsSync(envLocalPath) ? fs.readFileSync(envLocalPath, "utf-8") : "";

  const configLines = [
    `# Live Deployed MX-8004 Devnet Smart Contracts`,
    `MX8004_IDENTITY_REGISTRY=${results["IdentityRegistry"].contractAddress}`,
    `MX8004_VALIDATION_REGISTRY=${results["ValidationRegistry"].contractAddress}`,
    `MX8004_REPUTATION_REGISTRY=${results["ReputationRegistry"].contractAddress}`,
    `MX8004_ESCROW=${results["Escrow"].contractAddress}`,
  ];

  for (const line of configLines) {
    const key = line.split("=")[0];
    if (key && !key.startsWith("#")) {
      const regex = new RegExp(`^${key}=.*$`, "m");
      if (regex.test(envLocal)) {
        envLocal = envLocal.replace(regex, line);
      } else {
        envLocal += `\n${line}`;
      }
    }
  }
  fs.writeFileSync(envLocalPath, envLocal.trim() + "\n");
  console.log(`Updated ${envLocalPath} with contract addresses!`);
}

main().catch((err) => {
  console.error("Fatal deployment error:", err);
  process.exit(1);
});
