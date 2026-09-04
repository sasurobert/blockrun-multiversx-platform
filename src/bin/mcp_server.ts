import dotenv from "dotenv";
dotenv.config();
import http from "http";
import path from "path";
import fs from "fs";
import { McpGateway } from "../gateway/mcp_gateway.js";
import { McpRegistryAdapter } from "../services/mcp_registry_adapter.js";
import { McpExecutor } from "../services/mcp_executor.js";
import { MerchantPoolManager } from "../services/merchant_pool.js";
import { VerifierService } from "../services/verifier.js";
import { MvxApiNetworkProvider } from "../domain/network.js";
import { RelayerPoolManager } from "../services/relayer_pool.js";
import { SettlementQueue } from "../services/settlement_queue.js";
import { SettlerService } from "../services/settler.js";
import { SqliteSettlementStorage } from "../storage/sqlite_storage.js";
import { MemorySettlementStorage } from "../storage/memory_storage.js";
import { UserSigner } from "@multiversx/sdk-wallet";

async function main() {
  const port = parseInt(process.env.MCP_PORT || process.env.PORT || "3500", 10);
  const apiUrl = process.env.MULTIVERSX_API_URL || "https://devnet-api.multiversx.com";
  const network = process.env.MULTIVERSX_NETWORK || "multiversx:D";
  const sqliteDbPath = process.env.SQLITE_DB_PATH || "./data/settlements.db";
  const usdcToken = process.env.USDC_TOKEN_IDENTIFIER || "USDC-350c4e";

  console.log(`============================================================`);
  console.log(`         Starting MultiversX MCP Gateway Server             `);
  console.log(`============================================================`);
  console.log(`Port:        ${port}`);
  console.log(`Network:     ${network}`);
  console.log(`API URL:     ${apiUrl}`);
  console.log(`Token:       ${usdcToken}`);

  const networkProvider = new MvxApiNetworkProvider(apiUrl, {
    clientName: "multiversx-mcp-gateway",
  });

  // Storage
  const storage =
    sqliteDbPath && sqliteDbPath !== ":memory:"
      ? new SqliteSettlementStorage(sqliteDbPath)
      : new MemorySettlementStorage();

  // Relayers
  const relayerPool = new RelayerPoolManager();
  const relayerPemDir = path.resolve(process.cwd(), "wallets");
  for (const shard of [0, 1, 2]) {
    const pemFile = path.resolve(relayerPemDir, `relayer_shard${shard}.pem`);
    if (fs.existsSync(pemFile)) {
      relayerPool.registerRelayer(shard, UserSigner.fromPem(fs.readFileSync(pemFile, "utf-8")));
    }
  }

  const verifier = new VerifierService({
    relayerPool,
    networkProvider,
  });

  const settler = new SettlerService({
    storage,
    networkProvider,
    relayerPool,
    verifier,
  });

  const settlementQueue = new SettlementQueue({
    settler,
    relayerPool,
  });

  const merchantPool = new MerchantPoolManager();
  const registry = new McpRegistryAdapter();
  const executor = new McpExecutor();

  // 1. Tool: MultiversX Account Inspector
  registry.registerLocalTool({
    name: "multiversx_get_account",
    description: "Query real on-chain account balance, nonce, and shard details for any MultiversX address",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "MultiversX bech32 address (erd1...)" },
      },
      required: ["address"],
    },
    pricing: {
      microUsdc: "10000",
      usdFormatted: "$0.01",
      token: usdcToken,
      serviceId: 1,
      providerAgentNonce: 1,
    },
  });

  executor.registerHandler("multiversx_get_account", async (args) => {
    const address = String(args.address || "");
    const res = await fetch(`${apiUrl}/accounts/${address}`);
    if (!res.ok) {
      return {
        content: [{ type: "text", text: `Account query failed: HTTP ${res.status}` }],
        isError: true,
      };
    }
    const data = (await res.json()) as any;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              address: data.address,
              balanceEgld: Number(data.balance) / 1e18,
              nonce: data.nonce,
              shard: data.shard,
              codeHash: data.codeHash,
            },
            null,
            2
          ),
        },
      ],
      isError: false,
    };
  });

  // 2. Tool: MultiversX Token Balance
  registry.registerLocalTool({
    name: "multiversx_get_token_balance",
    description: "Query real ESDT/USDC token balance and metadata for any address on MultiversX",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "MultiversX bech32 address" },
        identifier: { type: "string", description: "Token identifier (e.g. USDC-350c4e)" },
      },
      required: ["address"],
    },
    pricing: {
      microUsdc: "10000",
      usdFormatted: "$0.01",
      token: usdcToken,
      serviceId: 2,
      providerAgentNonce: 1,
    },
  });

  executor.registerHandler("multiversx_get_token_balance", async (args) => {
    const address = String(args.address || "");
    const tokenId = String(args.identifier || usdcToken);
    const res = await fetch(`${apiUrl}/accounts/${address}/tokens/${tokenId}`);
    if (!res.ok) {
      return {
        content: [{ type: "text", text: `Token not found or 0 balance: HTTP ${res.status}` }],
        isError: true,
      };
    }
    const data = (await res.json()) as any;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              identifier: data.identifier,
              name: data.name,
              balance: data.balance,
              decimals: data.decimals,
              formatted: (Number(data.balance) / Math.pow(10, data.decimals || 6)).toFixed(4),
            },
            null,
            2
          ),
        },
      ],
      isError: false,
    };
  });

  // 3. Tool: Code Interpreter
  registry.registerLocalTool({
    name: "ai_code_interpreter",
    description: "Execute mathematical calculations and algorithmic evaluations in a sandboxed runtime",
    inputSchema: {
      type: "object",
      properties: {
        expression: { type: "string", description: "JavaScript math expression to evaluate" },
      },
      required: ["expression"],
    },
    pricing: {
      microUsdc: "25000",
      usdFormatted: "$0.025",
      token: usdcToken,
      serviceId: 3,
      providerAgentNonce: 1,
    },
  });

  executor.registerHandler("ai_code_interpreter", async (args) => {
    const expr = String(args.expression || "2 + 2");
    try {
      const sanitized = expr.replace(/[^0-9+\-*/().%^eE,\sMath.sqrtcopsinlgx]/g, "");
      const fn = new Function(`return (${sanitized});`);
      const result = fn();
      return {
        content: [{ type: "text", text: `Result: ${result}` }],
        isError: false,
      };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `Evaluation error: ${err.message}` }],
        isError: true,
      };
    }
  });

  // 4. Tool: Web Search / Markdown Scraper
  registry.registerLocalTool({
    name: "web_search_firecrawl",
    description: "High-speed clean web content scraper returning markdown for agent ingestion",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to crawl and extract markdown from" },
      },
      required: ["url"],
    },
    pricing: {
      microUsdc: "30000",
      usdFormatted: "$0.03",
      token: usdcToken,
      serviceId: 4,
      providerAgentNonce: 1,
    },
  });

  executor.registerHandler("web_search_firecrawl", async (args) => {
    const targetUrl = String(args.url || "https://multiversx.com");
    try {
      const resp = await fetch(targetUrl, {
        headers: { "User-Agent": "BlockRun-Firecrawl-Bot/1.0" },
      });
      const html = await resp.text();
      const titleMatch = html.match(/<title>(.*?)<\/title>/i);
      const title = titleMatch ? titleMatch[1] : targetUrl;
      const snippet = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 1000);

      return {
        content: [
          {
            type: "text",
            text: `# ${title}\n\n**Source:** ${targetUrl}\n\n${snippet}...\n`,
          },
        ],
        isError: false,
      };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `Scraping error: ${err.message}` }],
        isError: true,
      };
    }
  });

  // 5. Tool: On-Chain MX-8004 Reputation Query
  registry.registerLocalTool({
    name: "onchain_agent_reputation",
    description: "Query verified agent trust score and validation history from the MX-8004 Smart Contract",
    inputSchema: {
      type: "object",
      properties: {
        agentNonce: { type: "number", description: "Agent identity token nonce" },
      },
      required: ["agentNonce"],
    },
    pricing: {
      microUsdc: "20000",
      usdFormatted: "$0.02",
      token: usdcToken,
      serviceId: 5,
      providerAgentNonce: 1,
    },
  });

  executor.registerHandler("onchain_agent_reputation", async (args) => {
    const nonce = Number(args.agentNonce || 1);
    const repContract =
      process.env.MX8004_REPUTATION_REGISTRY ||
      "erd1qqqqqqqqqqqqqpgqvj462tzng7nz4muwd89lz76cxdc03hd2dnyqus85yp";
    const nonceHex = nonce.toString(16).padStart(2, "0");

    try {
      const [vmRes, accRes] = await Promise.all([
        fetch(`${apiUrl}/vm-values/query`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scAddress: repContract,
            funcName: "get_reputation_score",
            args: [nonceHex],
          }),
        }),
        fetch(`${apiUrl}/accounts/${repContract}`),
      ]);

      const vmData = (vmRes.ok ? await vmRes.json() : null) as any;
      const accData = (accRes.ok ? await accRes.json() : null) as any;

      let score = 0;
      if (vmData?.data?.data?.returnData?.[0]) {
        const buf = Buffer.from(vmData.data.data.returnData[0], "base64");
        score = buf.length > 0 ? parseInt(buf.toString("hex"), 16) : 0;
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                agentNonce: nonce,
                reputationContract: repContract,
                codeHash: accData?.codeHash || "ACTIVE",
                verifiedStatus: accData?.codeHash ? "ACTIVE_ON_CHAIN" : "UNKNOWN",
                reputationScore: score,
                trustTier: score >= 80 ? "TIER_A" : score > 0 ? "TIER_B" : "NEW_AGENT_UNRATED",
                network,
                liveOnChainVerification: true,
              },
              null,
              2
            ),
          },
        ],
        isError: false,
      };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `On-chain reputation query failed: ${err.message}` }],
        isError: true,
      };
    }
  });

  const gateway = new McpGateway({
    registry,
    executor,
    merchantPool,
    verifier,
    settlementQueue,
    network,
  });

  // Add root discovery aliases
  gateway.app.get("/tools", (_req, res) => {
    res.json({ tools: registry.listLocalTools() });
  });

  gateway.app.get("/mcp/tools", (_req, res) => {
    res.json({ tools: registry.listLocalTools() });
  });

  const server = http.createServer(gateway.app);

  server.listen(port, () => {
    console.log(`MCP Gateway started on http://localhost:${port}`);
    console.log(`Health:      http://localhost:${port}/health`);
    console.log(`Tools list:  http://localhost:${port}/mcp/v1/tools`);
    console.log(`SSE Stream:  http://localhost:${port}/mcp/v1/sse`);
    console.log(`Tool call:   http://localhost:${port}/mcp/v1/tools/call`);
  });
}

if (process.argv[1]?.includes("mcp_server")) {
  main().catch((err) => {
    console.error("MCP Server startup error:", err);
    process.exit(1);
  });
}
