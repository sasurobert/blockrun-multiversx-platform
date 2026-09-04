# @sasurobert/tollbooth-edge

Drop-in Edge & Cloudflare Worker middleware for **MultiversX x402 AI Scraper Tollbooths**.
Intercepts AI crawlers (GPTBot, ClaudeBot, PerplexityBot, ByteSpider, Google-Extended) at CDN edge in `<5ms` and monetizes content access via MultiversX gasless micro-payments.

## Quickstart

### Installation

```bash
npm install @sasurobert/tollbooth-edge
```

### Cloudflare Worker / Vercel Edge

```typescript
import { createTollboothEdgeHandler } from "@sasurobert/tollbooth-edge";

export default {
  fetch: createTollboothEdgeHandler({
    merchantAddress: "erd1ka0yrspygvjtktyzxu58ufn0kujkqgx4gq2ch5ev2aqjcem9jcqqkntrmv",
    network: "multiversx:D", // MultiversX Devnet
    tokenId: "USDC-350c4e", // Active Devnet USDC
    rateMicroUsdc: "1500", // $0.0015 per crawled page
  }),
};
```

### Express / Node.js Middleware

```typescript
import express from "express";
import { tollboothMiddleware } from "@sasurobert/tollbooth-edge";

const app = express();

app.use(
  tollboothMiddleware({
    merchantAddress: "erd1ka0yrspygvjtktyzxu58ufn0kujkqgx4gq2ch5ev2aqjcem9jcqqkntrmv",
    network: "multiversx:D",
    tokenId: "USDC-350c4e",
    rateMicroUsdc: "1500",
  })
);
```

## Features

- **Sub-5ms Edge Detection**: Human browsers pass through untouched with zero latency.
- **x402 v2 Standards**: Emits RFC-compliant `402 Payment Required` with `WWW-Authenticate` and `PAYMENT-REQUIRED` headers.
- **MultiversX Sirius Optimized**: Designed for sub-second block times and gasless Relayed V3 settlement.

## Author

Robert Sasu (<sasu.robert@gmail.com>)
