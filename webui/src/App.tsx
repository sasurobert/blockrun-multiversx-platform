import React, { useState } from "react";
import { Navbar, TabType } from "./components/Navbar";
import { AgentPlayground } from "./components/AgentPlayground";
import { AgentFleet } from "./components/AgentFleet";
import { ShardMonitor } from "./components/ShardMonitor";
import { StressVisualizer } from "./components/StressVisualizer";
import { ClawSpeedometer } from "./components/ClawSpeedometer";
import { McpMarketplace } from "./components/McpMarketplace";
import { TollboothDashboard } from "./components/TollboothDashboard";
import { DeveloperDocs } from "./components/DeveloperDocs";
import { WalletProvider } from "./context/WalletContext";
import { WalletModal } from "./components/WalletModal";
import { ErrorBoundary } from "./components/ErrorBoundary";

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>("playground");

  return (
    <ErrorBoundary>
      <WalletProvider>
        <div className="min-h-screen bg-[#080b11] text-slate-100 flex flex-col">
          <Navbar activeTab={activeTab} setActiveTab={setActiveTab} />

          <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {activeTab === "playground" && <AgentPlayground />}
            {activeTab === "claw" && <ClawSpeedometer />}
            {activeTab === "mcp" && <McpMarketplace />}
            {activeTab === "tollbooth" && <TollboothDashboard />}
            {activeTab === "fleet" && <AgentFleet />}
            {activeTab === "shards" && <ShardMonitor />}
            {activeTab === "benchmark" && <StressVisualizer />}
            {activeTab === "docs" && <DeveloperDocs />}
          </main>

          <footer className="border-t border-slate-800/80 bg-[#0d121f] py-6 text-center text-xs text-slate-500 font-mono">
            MultiversX x402 Engine • 10,000 TPS Sirius Sub-Second Architecture • Built for Autonomous AI Agents
          </footer>

          <WalletModal />
        </div>
      </WalletProvider>
    </ErrorBoundary>
  );
};

export default App;
