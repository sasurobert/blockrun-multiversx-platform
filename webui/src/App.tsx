import React, { useState } from "react";
import { Navbar } from "./components/Navbar";
import { AgentPlayground } from "./components/AgentPlayground";
import { AgentFleet } from "./components/AgentFleet";
import { ShardMonitor } from "./components/ShardMonitor";
import { StressVisualizer } from "./components/StressVisualizer";

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<"playground" | "fleet" | "shards" | "benchmark">("playground");

  return (
    <div className="min-h-screen bg-[#080b11] text-slate-100 flex flex-col">
      <Navbar activeTab={activeTab} setActiveTab={setActiveTab} />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === "playground" && <AgentPlayground />}
        {activeTab === "fleet" && <AgentFleet />}
        {activeTab === "shards" && <ShardMonitor />}
        {activeTab === "benchmark" && <StressVisualizer />}
      </main>

      <footer className="border-t border-slate-800/80 bg-[#0d121f] py-6 text-center text-xs text-slate-500 font-mono">
        MultiversX x402 Engine • 10,000 TPS Sirius Sub-Second Architecture • Built for Autonomous AI Agents
      </footer>
    </div>
  );
};

export default App;
