import React, { useState } from "react";
import { Server, Activity, ArrowUpRight, ShieldCheck, RefreshCw } from "lucide-react";

interface RelayerState {
  id: string;
  shard: number;
  address: string;
  inFlight: number;
  maxInFlight: number;
  balanceEgld: string;
  status: "idle" | "pipelining" | "active";
}

export const ShardMonitor: React.FC = () => {
  const [activeShardFilter, setActiveShardFilter] = useState<number | "all">("all");

  // Mock 24 relayer state across 3 shards (8 per shard)
  const relayers: RelayerState[] = Array.from({ length: 24 }).map((_, idx) => {
    const shard = Math.floor(idx / 8);
    const relayerIdxInShard = (idx % 8) + 1;
    const inFlight = Math.floor(Math.random() * 85) + 10;
    return {
      id: `relayer-s${shard}-${relayerIdxInShard}`,
      shard,
      address: `erd1${Array.from({ length: 58 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`,
      inFlight,
      maxInFlight: 250,
      balanceEgld: (Math.random() * 1.5 + 4.5).toFixed(4),
      status: inFlight > 50 ? "pipelining" : "active",
    };
  });

  const filteredRelayers = activeShardFilter === "all"
    ? relayers
    : relayers.filter((r) => r.shard === activeShardFilter);

  return (
    <div className="space-y-6">
      {/* Header Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-[#0f1523] border border-slate-800">
          <div className="text-xs text-slate-400">Total Active Relayers</div>
          <div className="text-2xl font-extrabold text-white mt-1 font-mono">24 Pipelined</div>
          <div className="text-[11px] text-emerald-400 mt-1 flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            8 workers per execution shard
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#0f1523] border border-slate-800">
          <div className="text-xs text-slate-400">Sirius Mempool Window</div>
          <div className="text-2xl font-extrabold text-cyan-300 mt-1 font-mono">250 tx/relayer</div>
          <div className="text-[11px] text-slate-400 mt-1">TxPoolConfig.MaxNumOfTxs</div>
        </div>

        <div className="p-4 rounded-xl bg-[#0f1523] border border-slate-800">
          <div className="text-xs text-slate-400">Theoretical Cluster Capacity</div>
          <div className="text-2xl font-extrabold text-blue-400 mt-1 font-mono">10,000+ TPS</div>
          <div className="text-[11px] text-blue-300 mt-1">24 × (250 / 0.6s) ≈ 10,000 TPS</div>
        </div>

        <div className="p-4 rounded-xl bg-[#0f1523] border border-slate-800">
          <div className="text-xs text-slate-400">Treasury Rebalancer</div>
          <div className="text-2xl font-extrabold text-emerald-400 mt-1 font-mono">Active</div>
          <div className="text-[11px] text-emerald-400 mt-1">Min balance floor: 1.0 EGLD</div>
        </div>
      </div>

      {/* Shard Filter Tabs */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {(["all", 0, 1, 2] as const).map((s) => (
            <button
              key={String(s)}
              onClick={() => setActiveShardFilter(s)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeShardFilter === s
                  ? "bg-blue-600 text-white shadow-md shadow-blue-600/30"
                  : "bg-[#131a29] text-slate-400 hover:text-white border border-slate-800"
              }`}
            >
              {s === "all" ? "All Shards (24 Workers)" : `Shard ${s} (8 Workers)`}
            </button>
          ))}
        </div>

        <button className="px-3 py-1.5 rounded-lg bg-[#151d2d] border border-slate-800 text-xs text-slate-400 hover:text-white flex items-center gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh Relayers
        </button>
      </div>

      {/* Relayers Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {filteredRelayers.map((relayer) => {
          const pct = Math.round((relayer.inFlight / relayer.maxInFlight) * 100);
          return (
            <div
              key={relayer.id}
              className="p-4 rounded-xl bg-[#0f1523] border border-slate-800/80 hover:border-slate-700 transition-all space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-blue-400" />
                  <span className="text-xs font-bold text-slate-200 font-mono">
                    Shard {relayer.shard} • #{relayer.id.split("-")[2]}
                  </span>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold ${
                  relayer.status === "pipelining"
                    ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                    : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                }`}>
                  {relayer.status}
                </span>
              </div>

              <div className="text-[11px] font-mono text-slate-400 truncate">
                {relayer.address.substring(0, 14)}...{relayer.address.substring(50)}
              </div>

              {/* In-Flight Sliding Window */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] font-mono">
                  <span className="text-slate-400">In-Flight Window:</span>
                  <span className="text-slate-200 font-semibold">{relayer.inFlight} / {relayer.maxInFlight}</span>
                </div>
                <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>

              {/* Balance */}
              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs font-mono">
                <span className="text-slate-400">Gas Balance:</span>
                <span className="text-emerald-400 font-bold">{relayer.balanceEgld} EGLD</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
