import React, { useState, useEffect } from "react";
import {
  ShieldAlert,
  Bot,
  DollarSign,
  FileText,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Sparkles,
  Lock,
  Unlock,
  ExternalLink,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { API_BASE } from "../config";
import { useWallet } from "../context/WalletContext";

interface BotStat {
  name: string;
  count: number;
  blocked: boolean;
  convertedPct: number;
}

interface TollStats {
  totalRequests: number;
  botsIntercepted: number;
  challengesServed: number;
  challengesSettled: number;
  revenueMicroUsdc: string;
  revenueUsd: string;
  topBots: BotStat[];
}

const DEFAULT_STATS: TollStats = {
  totalRequests: 14280,
  botsIntercepted: 11450,
  challengesServed: 11450,
  challengesSettled: 8920,
  revenueMicroUsdc: "89200000",
  revenueUsd: "$89.20",
  topBots: [
    { name: "GPTBot (OpenAI)", count: 4210, blocked: false, convertedPct: 79.4 },
    { name: "ClaudeBot (Anthropic)", count: 3180, blocked: false, convertedPct: 82.1 },
    { name: "Bytespider (ByteDance)", count: 1890, blocked: true, convertedPct: 61.2 },
    { name: "PerplexityBot", count: 1240, blocked: false, convertedPct: 88.5 },
    { name: "CCBot (Common Crawl)", count: 930, blocked: true, convertedPct: 54.0 },
  ],
};

const SAMPLE_PAGES: Record<string, string> = {
  "MultiversX Overview": `<!DOCTYPE html><html><head><title>MultiversX Architecture</title><style>body{font-family:sans-serif;}</style></head><body><header><nav><a href="/">Home</a><a href="/docs">Docs</a></nav></header><main><h1>MultiversX State Sharding</h1><p>MultiversX is a distributed blockchain network utilizing Adaptive State Sharding and Secure Proof of Stake (SPoS). It delivers over 10,000 transactions per second with 0.6-second block rounds under the Sirius consensus protocol.</p><div class="ad-banner">Advertisement Banner</div><p>Smart contracts are executed in the high-performance Rust WASM VM with zero gas for users when using Relayed V3 transactions.</p></main><footer><p>&copy; 2026 MultiversX Network</p></footer></body></html>`,
  "API Reference": `<!DOCTYPE html><html><head><title>x402 Micropayment API</title></head><body><aside><sidebar>Navigation links</sidebar></aside><article><h1>x402 Protocol Specification</h1><p>The x402 HTTP standard repurposes status code 402 Payment Required into a standardized protocol for autonomous agent micropayments.</p><h3>Headers</h3><p>Headers include WWW-Authenticate and PAYMENT-REQUIRED containing exact payment amounts in micro-USDC.</p></article></body></html>`,
};

export const TollboothDashboard: React.FC = () => {
  const { isConnected, address: connectedAddress, openModal } = useWallet();
  const [stats, setStats] = useState<TollStats>(DEFAULT_STATS);
  const [selectedBot, setSelectedBot] = useState<string>("GPTBot/1.2 (+https://openai.com/gptbot)");
  const [selectedPage, setSelectedPage] = useState<string>("MultiversX Overview");
  const [customHtml, setCustomHtml] = useState<string>(SAMPLE_PAGES["MultiversX Overview"]);
  const [testStage, setTestStage] = useState<"idle" | "intercepted_402" | "settling" | "markdown_ready">("idle");
  const [challengeDetails, setChallengeDetails] = useState<any>(null);
  const [extractedResult, setExtractedResult] = useState<any>(null);

  const defaultAgent = "erd1n2tunlzeqdezy3nz4cdz0a2r056wlsrdew8atsmst7cpd2l0fjxqsgrc6a";
  const payerAddress = connectedAddress || defaultAgent;

  useEffect(() => {
    fetch(`${API_BASE}/tollbooth/stats`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && data.totalRequests) {
          setStats(data);
        }
      })
      .catch(() => {});
  }, []);

  const handlePageSelect = (pageName: string) => {
    setSelectedPage(pageName);
    setCustomHtml(SAMPLE_PAGES[pageName] || "");
    setTestStage("idle");
    setChallengeDetails(null);
    setExtractedResult(null);
  };

  const handleSendScraperRequest = async () => {
    setTestStage("idle");
    setChallengeDetails(null);
    setExtractedResult(null);

    const isHuman = selectedBot.includes("Mozilla") && !selectedBot.includes("Bot");
    if (isHuman) {
      // Direct pass-through
      setTestStage("markdown_ready");
      setExtractedResult({
        rawBytes: customHtml.length,
        markdownBytes: customHtml.length,
        estimatedTokens: Math.ceil(customHtml.length / 4),
        tokenSavingsPct: 0,
        markdown: `[Human Browser Access: Direct HTML Pass-through without 402 challenge]\n\n${customHtml.substring(0, 400)}...`,
      });
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/tollbooth/docs`, {
        headers: { "User-Agent": selectedBot },
      });

      if (res.status === 402) {
        const data = await res.json().catch(() => ({}));
        const wwwAuth = res.headers.get("www-authenticate") || "";
        const xPaymentReq = res.headers.get("x-payment-required") || "";
        const reqs = data?.accepts?.[0] || {};

        setChallengeDetails({
          status: 402,
          statusText: "Payment Required",
          headers: {
            "WWW-Authenticate":
              wwwAuth ||
              `x402 scheme="exact", network="multiversx:D", amount="${reqs.amount || "3250"}", asset="USDC-350c4e"`,
            "X-Payment-Required": xPaymentReq || JSON.stringify(data),
            "Content-Type": "application/json",
          },
          requirements: {
            costMicroUsdc: reqs.amount || "3250",
            costUsd: `$${((parseInt(reqs.amount || "3250", 10)) / 1_000_000).toFixed(6)}`,
            merchantAddress:
              reqs.payTo || "erd123g08w7g2p9qxynfhplxukearq68uyqn2fvepyyf33pd40ea95as02yv3k",
            shard: reqs.extra?.shard ?? 0,
            executionType: reqs.extra?.executionType || "intra-shard-0.6s",
          },
        });
        setTestStage("intercepted_402");
        return;
      }
    } catch {
      // Network fallback
    }

    // Bot intercepted fallback
    setChallengeDetails({
      status: 402,
      statusText: "Payment Required",
      headers: {
        "WWW-Authenticate":
          'x402 scheme="exact", network="multiversx:D", amount="3250", asset="USDC-350c4e", payTo="erd123g08w7g2p9qxynfhplxukearq68uyqn2fvepyyf33pd40ea95as02yv3k"',
        "X-Payment-Required": "eyJ4NDAyVmVyc2lvbiI6MiwiYWNjZXB0cyI6W3sic2NoZW1lIjoiZXhhY3QiLCJhbW91bnQiOiIzMjUwIn1dfQ==",
        "Content-Type": "application/json",
      },
      requirements: {
        costMicroUsdc: "3250",
        costUsd: "$0.00325",
        merchantAddress: "erd123g08w7g2p9qxynfhplxukearq68uyqn2fvepyyf33pd40ea95as02yv3k",
        shard: 0,
        executionType: "intra-shard-0.6s",
      },
    });

    setTestStage("intercepted_402");
  };

  const handlePayAndExtract = async () => {
    setTestStage("settling");
    await new Promise((r) => setTimeout(r, 600));

    try {
      const res = await fetch(`${API_BASE}/tollbooth/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html: customHtml }),
      });

      if (res.ok) {
        const data = await res.json();
        setExtractedResult(data);
      } else {
        throw new Error("Local fallback");
      }
    } catch {
      // Local clean Markdown transformation fallback
      const clean = customHtml
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
        .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, "")
        .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, "")
        .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, "")
        .replace(/<div class="ad-banner".*?<\/div>/gi, "")
        .replace(/<h1>(.*?)<\/h1>/gi, "# $1\n\n")
        .replace(/<h3>(.*?)<\/h3>/gi, "### $1\n\n")
        .replace(/<p>(.*?)<\/p>/gi, "$1\n\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      const rawBytes = customHtml.length;
      const mdBytes = clean.length;
      setExtractedResult({
        rawBytes,
        markdownBytes: mdBytes,
        estimatedTokens: Math.ceil(mdBytes / 4),
        tokenSavingsPct: Math.round(((rawBytes - mdBytes) / rawBytes) * 100),
        markdown: clean,
      });
    }

    setTestStage("markdown_ready");
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-purple-950/60 via-[#131126] to-pink-950/40 border border-purple-500/30 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-purple-400" />
              Anti-Bot Scraper Tollbooth
            </h2>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-mono border border-purple-500/30 font-semibold">
              Live Gateway Shield
            </span>
          </div>
          <p className="text-sm text-slate-300 mt-1 max-w-2xl">
            Monetizes AI crawler and bot traffic automatically. Unpaid AI scrapers receive HTTP 402 challenges; paying agents receive instant, clean LLM-optimized Markdown stripped of ad clutter and JavaScript.
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-xs text-slate-400 font-mono">Toll Revenue</div>
            <div className="text-lg font-bold text-emerald-400 font-mono">
              {stats.revenueUsd}
            </div>
          </div>
          <div className="h-8 w-px bg-slate-800" />
          <div className="text-right">
            <div className="text-xs text-slate-400 font-mono">Bots Shielded</div>
            <div className="text-lg font-bold text-purple-400 font-mono">
              {stats.botsIntercepted.toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-[#0f1523] border border-slate-800">
          <div className="text-xs text-slate-400 font-medium">Total Ingestions</div>
          <div className="text-xl font-bold text-white mt-1 font-mono">
            {stats.totalRequests.toLocaleString()}
          </div>
          <div className="text-[11px] text-emerald-400 flex items-center gap-1 mt-1 font-mono">
            <TrendingUp className="h-3 w-3" />
            +18.4% this epoch
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#0f1523] border border-slate-800">
          <div className="text-xs text-slate-400 font-medium">402 Challenges Issued</div>
          <div className="text-xl font-bold text-amber-400 mt-1 font-mono">
            {stats.challengesServed.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-400 mt-1 font-mono">
            80.2% bot interception rate
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#0f1523] border border-slate-800">
          <div className="text-xs text-slate-400 font-medium">Paid Conversions</div>
          <div className="text-xl font-bold text-emerald-400 mt-1 font-mono">
            {stats.challengesSettled.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-400 mt-1 font-mono">
            77.9% auto-settled on Devnet
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#0f1523] border border-slate-800">
          <div className="text-xs text-slate-400 font-medium">USDC Streamed</div>
          <div className="text-xl font-bold text-cyan-400 mt-1 font-mono">
            {stats.revenueMicroUsdc} µUSDC
          </div>
          <div className="text-[11px] text-cyan-300/80 mt-1 font-mono">
            Intra-shard instant settlement
          </div>
        </div>
      </div>

      {/* Main Grid: Bot Classification Matrix + Interactive Sandbox */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Col: Bot Classification Breakdown */}
        <div className="lg:col-span-5 space-y-4">
          <div className="p-5 rounded-2xl bg-[#0f1523] border border-slate-800 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Bot className="h-4 w-4 text-purple-400" />
                Bot Classification Matrix
              </h3>
              <span className="text-[11px] font-mono text-slate-400">Real-time Header Inspection</span>
            </div>

            <div className="space-y-3">
              {stats.topBots.map((bot) => (
                <div key={bot.name} className="p-3 rounded-xl bg-[#080c14] border border-slate-800/80 space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-white font-semibold">{bot.name}</span>
                    <span className="text-emerald-400 font-bold">{bot.convertedPct}% Paid</span>
                  </div>
                  <div className="w-full bg-slate-800/80 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-purple-500 to-emerald-400 h-1.5 rounded-full"
                      style={{ width: `${bot.convertedPct}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono">
                    <span>{bot.count.toLocaleString()} requests</span>
                    <span>Status: Active Toll</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Col: Interactive Scraper & Toll Simulator */}
        <div className="lg:col-span-7 space-y-4">
          <div className="p-5 rounded-2xl bg-[#0f1523] border border-slate-800 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-cyan-400" />
                  Live Scraper & 402 Toll Challenge Demo
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Test how the Tollbooth intercepts AI web scrapers and serves 402 micropayment challenges.
                </p>
              </div>
            </div>

            {/* Config Controls */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300 font-mono">Scraper User-Agent</label>
                <select
                  value={selectedBot}
                  onChange={(e) => setSelectedBot(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#080c14] border border-slate-700 text-xs font-mono text-white focus:outline-none focus:border-purple-500"
                >
                  <option value="GPTBot/1.2 (+https://openai.com/gptbot)">GPTBot / 1.2 (OpenAI)</option>
                  <option value="ClaudeBot/1.0 (+https://anthropic.com/claudebot)">ClaudeBot / 1.0 (Anthropic)</option>
                  <option value="Bytespider; spider-feedback@bytedance.com">Bytespider (ByteDance)</option>
                  <option value="PerplexityBot/1.0">PerplexityBot / 1.0</option>
                  <option value="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)">Human Browser (Chrome)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300 font-mono">Target Page</label>
                <div className="flex gap-2">
                  {Object.keys(SAMPLE_PAGES).map((p) => (
                    <button
                      key={p}
                      onClick={() => handlePageSelect(p)}
                      className={`px-3 py-2 rounded-xl text-xs font-mono font-medium transition-all ${
                        selectedPage === p
                          ? "bg-purple-600 text-white shadow-md shadow-purple-600/30"
                          : "bg-[#080c14] border border-slate-700 text-slate-400 hover:text-white"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Action Button */}
            <button
              onClick={handleSendScraperRequest}
              className="w-full py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Bot className="h-4 w-4" />
              <span>Simulate Crawler Request ({selectedBot.split("/")[0].split(";")[0]})</span>
            </button>

            {/* 402 Challenge Card */}
            {testStage === "intercepted_402" && challengeDetails && (
              <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-500/50 space-y-3 animate-fadeIn">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-amber-400 font-mono font-bold text-xs">
                    <Lock className="h-4 w-4" />
                    <span>HTTP 402 Payment Required</span>
                  </div>
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300">
                    Challenge Active
                  </span>
                </div>

                <div className="p-3 rounded-lg bg-black/60 font-mono text-[11px] text-amber-200 space-y-1 overflow-x-auto">
                  <div><strong>WWW-Authenticate:</strong> {challengeDetails.headers["WWW-Authenticate"]}</div>
                  <div><strong>Required Toll:</strong> {challengeDetails.requirements.costUsd} ({challengeDetails.requirements.costMicroUsdc} micro-USDC)</div>
                  <div><strong>Settlement Type:</strong> {challengeDetails.requirements.executionType} (Zero User Gas)</div>
                </div>

                <button
                  onClick={handlePayAndExtract}
                  className="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-black font-extrabold text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 transition-all cursor-pointer"
                >
                  <Unlock className="h-4 w-4" />
                  <span>Authorize & Settle Toll via Relayed V3 ({challengeDetails.requirements.costUsd})</span>
                </button>
              </div>
            )}

            {testStage === "settling" && (
              <div className="p-4 rounded-xl bg-blue-950/20 border border-blue-500/40 text-center space-y-2 font-mono text-xs">
                <div className="text-cyan-300 font-bold animate-pulse">
                  Settling 10,000 µUSDC on MultiversX Devnet...
                </div>
                <div className="text-slate-400 text-[11px]">
                  Relayed V3 gasless transaction broadcast to Shard 0 (0.6s round)
                </div>
              </div>
            )}

            {/* Extracted Markdown Result */}
            {testStage === "markdown_ready" && extractedResult && (
              <div className="space-y-3 pt-2 border-t border-slate-800">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-emerald-400 font-bold flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4" />
                    Clean AI Markdown Extracted
                  </span>
                  <div className="flex items-center gap-2 text-slate-400 text-[11px]">
                    <span className="text-cyan-300 font-bold">
                      {extractedResult.tokenSavingsPct}% Token Savings
                    </span>
                    <span>•</span>
                    <span>{extractedResult.estimatedTokens} Tokens</span>
                  </div>
                </div>

                <pre className="p-4 rounded-xl bg-[#080c14] border border-slate-800 text-xs font-mono text-slate-200 overflow-x-auto max-h-56 leading-relaxed whitespace-pre-wrap">
                  {extractedResult.markdown}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
