import React from "react";
import { X, Smartphone, Globe, Shield, Sparkles, ExternalLink, ArrowRight } from "lucide-react";
import { useWallet } from "../context/WalletContext";

export const WalletModal: React.FC = () => {
  const { isModalOpen, closeModal, connectExtension, connectDemoWallet, connectWebWallet, connectXPortal, isConnecting } = useWallet();

  if (!isModalOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="relative w-full max-w-md rounded-2xl bg-[#0f1523] border border-slate-800 shadow-2xl shadow-blue-500/10 p-6 space-y-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Shield className="h-5 w-5 text-cyan-400" />
              Connect MultiversX Wallet
            </h3>
            <p className="text-xs text-slate-400">Select your preferred MultiversX wallet provider for Devnet</p>
          </div>
          <button 
            onClick={closeModal}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Options List */}
        <div className="space-y-3">
          {/* Option 1: xPortal */}
          <button
            onClick={connectXPortal}
            disabled={isConnecting}
            className="w-full flex items-center justify-between p-3.5 rounded-xl bg-[#151c2d] hover:bg-[#1a2338] border border-slate-800 hover:border-cyan-500/40 transition-all text-left group"
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-cyan-400">
                <Smartphone className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-semibold text-white group-hover:text-cyan-300 transition-colors flex items-center gap-1.5">
                  xPortal App
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 font-normal">Mobile QR</span>
                </div>
                <div className="text-xs text-slate-400">Scan QR code using the xPortal mobile app</div>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-slate-500 group-hover:text-cyan-400 group-hover:translate-x-0.5 transition-all" />
          </button>

          {/* Option 2: DeFi Wallet Extension */}
          <button
            onClick={connectExtension}
            disabled={isConnecting}
            className="w-full flex items-center justify-between p-3.5 rounded-xl bg-[#151c2d] hover:bg-[#1a2338] border border-slate-800 hover:border-blue-500/40 transition-all text-left group"
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                <Globe className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-semibold text-white group-hover:text-indigo-300 transition-colors flex items-center gap-1.5">
                  MultiversX DeFi Wallet
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 font-normal">Extension</span>
                </div>
                <div className="text-xs text-slate-400">Chrome, Brave, and Chromium browser extension</div>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-slate-500 group-hover:text-indigo-400 group-hover:translate-x-0.5 transition-all" />
          </button>

          {/* Option 3: Web Wallet */}
          <button
            onClick={connectWebWallet}
            disabled={isConnecting}
            className="w-full flex items-center justify-between p-3.5 rounded-xl bg-[#151c2d] hover:bg-[#1a2338] border border-slate-800 hover:border-purple-500/40 transition-all text-left group"
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                <ExternalLink className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-semibold text-white group-hover:text-purple-300 transition-colors flex items-center gap-1.5">
                  MultiversX Web Wallet
                </div>
                <div className="text-xs text-slate-400">Devnet Web Wallet browser portal</div>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-slate-500 group-hover:text-purple-400 group-hover:translate-x-0.5 transition-all" />
          </button>

          {/* Option 4: Instant Pre-Funded Demo Agent */}
          <button
            onClick={connectDemoWallet}
            disabled={isConnecting}
            className="w-full flex items-center justify-between p-3.5 rounded-xl bg-gradient-to-r from-cyan-950/40 to-blue-950/40 hover:from-cyan-900/50 hover:to-blue-900/50 border border-cyan-500/30 hover:border-cyan-400 transition-all text-left group"
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-cyan-500/20 border border-cyan-400/30 flex items-center justify-center text-cyan-300">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-semibold text-cyan-200 flex items-center gap-1.5">
                  Pre-Funded Demo Agent
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-mono font-bold">15 USDC Ready</span>
                </div>
                <div className="text-xs text-slate-400">Instant 1-click test wallet with 0 EGLD gas fees</div>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-cyan-400 group-hover:translate-x-0.5 transition-all" />
          </button>
        </div>

        {/* Footer info */}
        <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400 font-mono">
          <span>Network: Devnet (multiversx:D)</span>
          <span>Relayed V3 Gasless</span>
        </div>
      </div>
    </div>
  );
};
