import React, { useState } from "react";
import {
  BookOpen,
  Code,
  Terminal,
  ExternalLink,
  Copy,
  Check,
  ShieldCheck,
  Wrench,
  Gauge,
  ShieldAlert,
  Layers,
} from "lucide-react";
import { API_BASE_URL } from "../config";

export const DeveloperDocs: React.FC = () => {
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  const copyToClipboard = (text: string, sectionId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(sectionId);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Hero Header */}
      <div className="bg-gradient-to-r from-slate-900 via-[#101827] to-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs font-mono font-semibold">
              <BookOpen className="h-3.5 w-3.5" />
              Developer Hub & OpenAPI 3.0 Specs
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              MultiversX x402 Ecosystem Documentation
            </h1>
            <p className="text-sm text-slate-400 max-w-2xl">
              Complete reference for autonomous AI agent micropayments, MCP marketplace execution, anti-bot edge tollbooths, and ClawRouter sub-second inference.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <a
              href={`${API_BASE_URL}/docs`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black font-bold text-xs shadow-lg shadow-cyan-500/20 transition-all cursor-pointer"
            >
              <ExternalLink className="h-4 w-4" />
              Interactive Swagger UI
            </a>
            <a
              href={`${API_BASE_URL}/openapi.json`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs border border-slate-700 transition-all cursor-pointer"
            >
              <Code className="h-4 w-4" />
              OpenAPI JSON
            </a>
          </div>
        </div>
      </div>

      {/* Official Packages Grid */}
      <div>
        <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <Layers className="h-5 w-5 text-cyan-400" />
          Official SDK & Client Packages
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-[#101827] border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-all">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                npm package
              </span>
              <span className="text-xs text-slate-500">v1.0.0</span>
            </div>
            <h3 className="font-bold text-slate-200 font-mono text-sm mb-1">
              @sasurobert/multiversx-x402
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              TypeScript / JavaScript client SDK for seamless MultiversX x402 HTTP 402 client-side interception and signing.
            </p>
            <div className="flex items-center justify-between bg-black/50 p-2.5 rounded-lg border border-slate-800 font-mono text-xs text-slate-300">
              <code>npm i @sasurobert/multiversx-x402</code>
              <button
                onClick={() => copyToClipboard("npm i @sasurobert/multiversx-x402", "pkg-npm-sdk")}
                className="text-slate-400 hover:text-white"
              >
                {copiedSection === "pkg-npm-sdk" ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="bg-[#101827] border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-all">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-mono font-bold text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/20">
                Cloudflare / Edge
              </span>
              <span className="text-xs text-slate-500">v1.0.0</span>
            </div>
            <h3 className="font-bold text-slate-200 font-mono text-sm mb-1">
              @sasurobert/tollbooth-edge
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              Ultra-lightweight edge middleware for Cloudflare Workers, Next.js, and Express with markdown caching and bot gating.
            </p>
            <div className="flex items-center justify-between bg-black/50 p-2.5 rounded-lg border border-slate-800 font-mono text-xs text-slate-300">
              <code>npm i @sasurobert/tollbooth-edge</code>
              <button
                onClick={() => copyToClipboard("npm i @sasurobert/tollbooth-edge", "pkg-npm-edge")}
                className="text-slate-400 hover:text-white"
              >
                {copiedSection === "pkg-npm-edge" ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="bg-[#101827] border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-all">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-mono font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">
                Python Package
              </span>
              <span className="text-xs text-slate-500">v1.0.0</span>
            </div>
            <h3 className="font-bold text-slate-200 font-mono text-sm mb-1">
              multiversx-x402
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              Native Python client for LangChain, AutoGen, and CrewAI autonomous agents settling x402 on MultiversX Devnet.
            </p>
            <div className="flex items-center justify-between bg-black/50 p-2.5 rounded-lg border border-slate-800 font-mono text-xs text-slate-300">
              <code>pip install multiversx-x402</code>
              <button
                onClick={() => copyToClipboard("pip install multiversx-x402", "pkg-pip")}
                className="text-slate-400 hover:text-white"
              >
                {copiedSection === "pkg-pip" ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Product 1: MCP Marketplace */}
      <div className="bg-[#101827] border border-slate-800 rounded-2xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
            <Wrench className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Product 1: MCP Tool Marketplace</h2>
            <p className="text-xs text-slate-400">Model Context Protocol with Ed25519 Tool Ownership & Zero-Settlement Sandbox</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 font-mono text-xs overflow-x-auto text-slate-300">
            <div className="text-slate-500 mb-2">// 1. Register MCP Tool with Ed25519 Cryptographic Signature</div>
            <pre>{`POST /mcp/v1/tools/register
Content-Type: application/json

{
  "id": "weather-oracle",
  "name": "Live Weather Oracle",
  "description": "Returns current weather metrics",
  "payTo": "erd19x402merchantaddress...",
  "priceUsd": "0.005",
  "inputSchema": { "type": "object", "properties": { "city": { "type": "string" } } },
  "code": "function execute(args) { return { temp: 22, condition: 'Sunny' }; }",
  "signature": "3045022100a9...<ed25519-signature-over-id:payTo:priceUsd>"
}`}</pre>
          </div>

          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 font-mono text-xs overflow-x-auto text-slate-300">
            <div className="text-slate-500 mb-2">// 2. Execute MCP Tool with x402 Micropayment (Automated Escrow Refund on Failure)</div>
            <pre>{`POST /mcp/v1/tools/weather-oracle/execute
PAYMENT-SIGNATURE: eyJ4NDAyVmVyc2lvbiI6Miwic2NoZW1lIjoiZXhhY3QiLCJuZXR3b3JrIjoibXVsdGl2ZXJzeDJEIn0=
Content-Type: application/json

{
  "parameters": { "city": "Bucharest" }
}`}</pre>
          </div>
        </div>
      </div>

      {/* Product 2: Anti-Bot Scraper Tollbooth */}
      <div className="bg-[#101827] border border-slate-800 rounded-2xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-400">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Product 2: Anti-Bot Scraper Tollbooth</h2>
            <p className="text-xs text-slate-400">Edge Markdown Caching (&lt;10ms, ETag 304) and DNS/HTML Publisher Verification</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 font-mono text-xs overflow-x-auto text-slate-300">
            <div className="text-slate-500 mb-2">// 1. Generate Domain Verification Challenge</div>
            <pre>{`POST /tollbooth/v1/publishers/challenge
Content-Type: application/json

{ "domain": "example.com" }

// Response:
{
  "domain": "example.com",
  "challengeToken": "x402-chal-a1b2c3d4...",
  "instructions": {
    "dnsTxt": "_x402-challenge.example.com TXT \"x402-chal-a1b2c3d4...\"",
    "metaHtml": "<meta name=\\"x402-verification\\" content=\\"x402-chal-a1b2c3d4...\\">"
  }
}`}</pre>
          </div>

          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 font-mono text-xs overflow-x-auto text-slate-300">
            <div className="text-slate-500 mb-2">// 2. Verify Publisher Ownership</div>
            <pre>{`POST /tollbooth/v1/publishers/verify
Content-Type: application/json

{ "domain": "example.com", "method": "dns" } // or "meta"`}</pre>
          </div>
        </div>
      </div>

      {/* Product 3: ClawRouter */}
      <div className="bg-[#101827] border border-slate-800 rounded-2xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
            <Gauge className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Product 3: ClawRouter Sub-Second Inference</h2>
            <p className="text-xs text-slate-400">OpenAI-Compatible Streaming, TTFT Cascading Fallback & Dynamic Spot Pricing</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 font-mono text-xs overflow-x-auto text-slate-300">
            <div className="text-slate-500 mb-2">// Ingest Dynamic Spot Pricing Feed</div>
            <pre>{`POST /api/v1/claw/spot-pricing
Content-Type: application/json

[
  { "id": "groq-fast", "costPerMillionInputTokensUsd": 0.50, "tokensPerSecond": 280 },
  { "id": "cerebras-ultra", "costPerMillionInputTokensUsd": 0.60, "tokensPerSecond": 950 }
]`}</pre>
          </div>

          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 font-mono text-xs overflow-x-auto text-slate-300">
            <div className="text-slate-500 mb-2">// OpenAI Client SDK Configuration</div>
            <pre>{`import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://100.115.111.51.sslip.io/v1", // or http://localhost:4400/v1
  apiKey: "x402-devnet-direct", // Handled via x402 payment header
});

const response = await client.chat.completions.create({
  model: "auto:speed", // auto:cost, auto:balanced, llama-3.3-70b, deepseek-r1
  messages: [{ role: "user", content: "Optimize routing algorithm" }],
  stream: true,
});`}</pre>
          </div>
        </div>
      </div>
    </div>
  );
};
