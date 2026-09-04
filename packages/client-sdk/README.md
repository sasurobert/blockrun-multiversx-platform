# @sasurobert/multiversx-x402

> MultiversX x402 Client SDK for autonomous agent payments, MCP tools, and AI scrapers on Devnet.

**Author**: Robert Sasu <sasu.robert@gmail.com>  
**Target Network**: MultiversX Devnet (`multiversx:D`)  
**Settlement Asset**: `USDC-350c4e`  
**License**: MIT  

---

## Features

- **Autonomous x402 Payment Loop**: Transparently intercepts HTTP 402 Payment Required challenges and generates cryptographic Relayed V3 transactions without user intervention.
- **MCP Gateway Integration**: Seamlessly call paid Model Context Protocol (MCP) tools and read MCP resources.
- **Tollbooth Web Scraping**: Clean Markdown extraction from bot-monetized websites via pay-per-crawl.
- **Enterprise Key Signing**: Support for file-based PEM wallets, mnemonic phrases, and hardware KMS/Vault signing via `IKeySigner`.
- **Intra-Shard 0.6s Finality**: Automatically targets MultiversX Sirius block times and shard routing.

---

## Installation

```bash
npm install @sasurobert/multiversx-x402 @multiversx/sdk-core @multiversx/sdk-wallet
```

---

## Quickstart

### 1. Initialize from PEM Wallet

```typescript
import { MultiversxX402Client } from "@sasurobert/multiversx-x402";

const client = MultiversxX402Client.fromPem("./wallet.pem", {
  gatewayUrl: "http://localhost:3000",
  network: "multiversx:D",
  tokenIdentifier: "USDC-350c4e",
  maxCostPerCallUsd: 0.05,
});

console.log("Agent Address:", client.getWalletAddress());
```

### 2. OpenAI-Compatible Chat Completion with x402 Micropayment

```typescript
const response = await client.chat("openai/gpt-5.4", [
  { role: "user", content: "Analyze MultiversX sharding architecture" },
]);

console.log("Response:", response.choices[0].message.content);
console.log("Settlement Receipt:", response.paymentReceipt);
```

### 3. MCP Tool Call

```typescript
// List available tools with on-chain pricing
const tools = await client.listTools();
console.log("Available tools:", tools);

// Call a paid tool
const result = await client.callTool("multiversx-analyzer", {
  contractAddress: "erd1qqqqqqqqqqqqqpgqvj462tzng7nz4muwd89lz76cxdc03hd2dnyqus85yp",
});

console.log("Tool Result:", result.toolResult);
console.log("Payment Receipt:", result.paymentReceipt);
```

### 4. Protected Markdown Scraping

```typescript
const markdown = await client.fetchProtectedMarkdown("https://example.com/docs/api");
console.log(markdown);
```

---

## License

MIT © Robert Sasu
