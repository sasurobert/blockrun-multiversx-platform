import React from "react";
import { Zap, Cpu, Activity, ExternalLink, Wallet, LogOut, Gauge, Wrench, ShieldAlert } from "lucide-react";
import { useWallet } from "../context/WalletContext";

export type TabType = "playground" | "claw" | "mcp" | "tollbooth" | "fleet" | "shards" | "benchmark";

interface NavbarProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ activeTab, setActiveTab }) => {
  const { isConnected, address, egldBalance, usdcBalance, openModal, disconnect } = useWallet();

  const truncate = (addr: string) => `${addr.slice(0, 7)}...${addr.slice(-5)}`;

  return (
    <header className="border-b border-slate-800/80 bg-[#0d121f]/90 backdrop-blur sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-2">
        {/* Brand */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-blue-600 to-cyan-400 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Zap className="h-5 w-5 text-black fill-black" />
          </div>
          <div className="hidden sm:block">
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
                BlockRun
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-semibold font-mono">
                MultiversX x402
              </span>
            </div>
            <p className="text-[11px] text-slate-400">10,000 TPS Sirius Sub-Second Architecture</p>
          </div>
        </div>

        {/* Center Tabs */}
        <div className="flex items-center gap-1 bg-[#151c2d] p-1 rounded-xl border border-slate-800 overflow-x-auto">
          <button
            onClick={() => setActiveTab("playground")}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer ${
              activeTab === "playground"
                ? "bg-blue-600 text-white shadow-md shadow-blue-600/30"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Cpu className="h-3.5 w-3.5" />
            Playground
          </button>
          <button
            onClick={() => setActiveTab("claw")}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer ${
              activeTab === "claw"
                ? "bg-amber-500 text-black font-bold shadow-md shadow-amber-500/30"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Gauge className="h-3.5 w-3.5" />
            ClawRouter
          </button>
          <button
            onClick={() => setActiveTab("mcp")}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer ${
              activeTab === "mcp"
                ? "bg-cyan-500 text-black font-bold shadow-md shadow-cyan-500/30"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Wrench className="h-3.5 w-3.5" />
            MCP Tools
          </button>
          <button
            onClick={() => setActiveTab("tollbooth")}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer ${
              activeTab === "tollbooth"
                ? "bg-purple-600 text-white shadow-md shadow-purple-600/30"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <ShieldAlert className="h-3.5 w-3.5" />
            Tollbooth
          </button>
          <button
            onClick={() => setActiveTab("fleet")}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer ${
              activeTab === "fleet"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Activity className="h-3.5 w-3.5 text-indigo-300" />
            Fleet
          </button>
          <button
            onClick={() => setActiveTab("shards")}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer ${
              activeTab === "shards"
                ? "bg-blue-600 text-white shadow-md shadow-blue-600/30"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Activity className="h-3.5 w-3.5" />
            Relayers
          </button>
          <button
            onClick={() => setActiveTab("benchmark")}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer ${
              activeTab === "benchmark"
                ? "bg-gradient-to-r from-cyan-500 to-blue-600 text-black font-bold shadow-md shadow-cyan-500/30"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Zap className="h-3.5 w-3.5" />
            10k TPS
          </button>
        </div>

        {/* Right Section: MultiversX Wallet Connect */}
        <div className="flex items-center gap-2.5 shrink-0">
          {isConnected && address ? (
            <div className="flex items-center gap-2 p-1.5 pl-3 rounded-xl bg-[#151c2d] border border-cyan-500/30 text-xs font-mono">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-slate-200 font-semibold">{truncate(address)}</span>
              <div className="hidden md:flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-black/40 border border-slate-700/50 text-[11px] text-cyan-300">
                <span>{egldBalance} EGLD</span>
                <span className="text-slate-500">•</span>
                <span className="text-emerald-400 font-bold">{usdcBalance} USDC</span>
              </div>
              <button
                onClick={disconnect}
                title="Disconnect Wallet"
                className="p-1 rounded-lg hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={openModal}
              className="py-2 px-3.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-black font-bold text-xs flex items-center gap-2 shadow-lg shadow-cyan-500/20 transition-all cursor-pointer"
            >
              <Wallet className="h-3.5 w-3.5" />
              <span>Connect Wallet</span>
            </button>
          )}

          <a
            href="https://devnet-explorer.multiversx.com"
            target="_blank"
            rel="noopener noreferrer"
            title="Devnet Explorer"
            className="hidden xl:flex items-center gap-1 text-xs text-slate-400 hover:text-cyan-400 p-2 rounded-lg hover:bg-slate-800/50 transition-colors"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </div>
    </header>
  );
};
