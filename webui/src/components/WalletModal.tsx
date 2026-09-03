import React, { useState } from "react";
import { X, Smartphone, Globe, Shield, Sparkles, ExternalLink, ArrowRight, FileKey, Upload, ArrowLeft, CheckCircle2, AlertCircle } from "lucide-react";
import { useWallet } from "../context/WalletContext";

const SAMPLE_DEMO_PEM = `-----BEGIN PRIVATE KEY for erd1n2tunlzeqdezy3nz4cdz0a2r056wlsrdew8atsmst7cpd2l0fjxqsgrc6a-----
NDVhYTkzYjQyNzE2NjBiNjBkMzBkZmU2OTU2ZmYwY2UxNjgxNDVlZTllOWVhMDdi
MWFlOTI3NDQ2NTM4MTdiY2QxYjc1MGE1ZjBkODk4ZjJmYjI5ZjFjMDhkMjVjMTc4
ODMwYTNmMzg2YTcxODBiNWQ4NjYxOGY0OWFkMGJiNmM=
-----END PRIVATE KEY for erd1n2tunlzeqdezy3nz4cdz0a2r056wlsrdew8atsmst7cpd2l0fjxqsgrc6a-----`;

export const WalletModal: React.FC = () => {
  const { isModalOpen, closeModal, connectExtension, connectDemoWallet, connectWebWallet, connectXPortal, connectPemWallet, isConnecting } = useWallet();
  const [isPemView, setIsPemView] = useState<boolean>(false);
  const [pemText, setPemText] = useState<string>("");
  const [pemError, setPemError] = useState<string | null>(null);

  if (!isModalOpen) return null;

  const handlePemSubmit = () => {
    setPemError(null);
    if (!pemText.trim()) {
      setPemError("Please paste or upload your PEM file contents.");
      return;
    }

    const res = connectPemWallet(pemText);
    if (!res.success) {
      setPemError(res.error || "Invalid PEM file format.");
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setPemText(content);
      setPemError(null);
    };
    reader.readAsText(file);
  };

  const handleClose = () => {
    setIsPemView(false);
    setPemText("");
    setPemError(null);
    closeModal();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="relative w-full max-w-md rounded-2xl bg-[#0f1523] border border-slate-800 shadow-2xl shadow-blue-500/10 p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isPemView && (
              <button
                onClick={() => { setIsPemView(false); setPemError(null); }}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors mr-1"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <div className="space-y-0.5">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Shield className="h-4 w-4 text-cyan-400" />
                {isPemView ? "Connect with PEM Key" : "Connect MultiversX Wallet"}
              </h3>
              <p className="text-[11px] text-slate-400">
                {isPemView ? "Upload or paste your MultiversX .pem file" : "Select your preferred MultiversX provider for Devnet"}
              </p>
            </div>
          </div>
          <button 
            onClick={handleClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {isPemView ? (
          /* PEM Upload & Paste View */
          <div className="space-y-4">
            {pemError && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-400 flex items-center gap-2 font-mono">
                <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
                <span>{pemError}</span>
              </div>
            )}

            {/* File Upload Zone */}
            <div>
              <label className="border-2 border-dashed border-slate-700 hover:border-cyan-500/50 rounded-xl p-4 flex flex-col items-center justify-center cursor-pointer transition-colors bg-[#151c2d]/60 group">
                <Upload className="h-6 w-6 text-slate-400 group-hover:text-cyan-400 mb-1.5 transition-colors" />
                <span className="text-xs font-semibold text-slate-300 group-hover:text-white">Choose a .pem file</span>
                <span className="text-[10px] text-slate-400 mt-0.5">or drag and drop here</span>
                <input 
                  type="file" 
                  accept=".pem,.txt" 
                  onChange={handleFileUpload}
                  className="hidden" 
                />
              </label>
            </div>

            {/* Paste Box */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>Or paste PEM content:</span>
                <button
                  onClick={() => { setPemText(SAMPLE_DEMO_PEM); setPemError(null); }}
                  className="text-cyan-400 hover:text-cyan-300 transition-colors font-semibold"
                >
                  Load Demo 15 USDC PEM
                </button>
              </div>
              <textarea
                value={pemText}
                onChange={(e) => { setPemText(e.target.value); setPemError(null); }}
                placeholder="-----BEGIN PRIVATE KEY for erd1...-----&#10;...&#10;-----END PRIVATE KEY for erd1...-----"
                rows={4}
                className="w-full p-3 rounded-xl bg-[#080b11] border border-slate-800 text-xs font-mono text-slate-200 focus:outline-none focus:border-cyan-500/60 placeholder:text-slate-600 resize-none"
              />
            </div>

            <button
              onClick={handlePemSubmit}
              className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-black font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/20 transition-all cursor-pointer"
            >
              <FileKey className="h-4 w-4" />
              Unlock & Connect PEM Wallet
            </button>
          </div>
        ) : (
          /* Standard Provider Options */
          <div className="space-y-2.5">
            {/* Option 1: PEM Key File */}
            <button
              onClick={() => setIsPemView(true)}
              className="w-full flex items-center justify-between p-3 rounded-xl bg-[#151c2d] hover:bg-[#1a2338] border border-slate-800 hover:border-emerald-500/40 transition-all text-left group"
            >
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                  <FileKey className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-white group-hover:text-emerald-300 transition-colors flex items-center gap-1.5">
                    PEM Key File
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-normal">Devnet Recommended</span>
                  </div>
                  <div className="text-[11px] text-slate-400">Upload or paste your MultiversX .pem wallet</div>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-slate-500 group-hover:text-emerald-400 group-hover:translate-x-0.5 transition-all" />
            </button>

            {/* Option 2: xPortal */}
            <button
              onClick={connectXPortal}
              disabled={isConnecting}
              className="w-full flex items-center justify-between p-3 rounded-xl bg-[#151c2d] hover:bg-[#1a2338] border border-slate-800 hover:border-cyan-500/40 transition-all text-left group"
            >
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-cyan-400">
                  <Smartphone className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-white group-hover:text-cyan-300 transition-colors flex items-center gap-1.5">
                    xPortal App
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 font-normal">Mobile QR</span>
                  </div>
                  <div className="text-[11px] text-slate-400">Scan QR code using xPortal mobile</div>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-slate-500 group-hover:text-cyan-400 group-hover:translate-x-0.5 transition-all" />
            </button>

            {/* Option 3: DeFi Wallet Extension */}
            <button
              onClick={connectExtension}
              disabled={isConnecting}
              className="w-full flex items-center justify-between p-3 rounded-xl bg-[#151c2d] hover:bg-[#1a2338] border border-slate-800 hover:border-indigo-500/40 transition-all text-left group"
            >
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                  <Globe className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-white group-hover:text-indigo-300 transition-colors flex items-center gap-1.5">
                    MultiversX DeFi Wallet
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 font-normal">Extension</span>
                  </div>
                  <div className="text-[11px] text-slate-400">Chrome, Brave, Chromium extension</div>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-slate-500 group-hover:text-indigo-400 group-hover:translate-x-0.5 transition-all" />
            </button>

            {/* Option 4: Web Wallet */}
            <button
              onClick={connectWebWallet}
              disabled={isConnecting}
              className="w-full flex items-center justify-between p-3 rounded-xl bg-[#151c2d] hover:bg-[#1a2338] border border-slate-800 hover:border-purple-500/40 transition-all text-left group"
            >
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                  <ExternalLink className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-white group-hover:text-purple-300 transition-colors">
                    MultiversX Web Wallet
                  </div>
                  <div className="text-[11px] text-slate-400">Devnet Web Wallet browser portal</div>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-slate-500 group-hover:text-purple-400 group-hover:translate-x-0.5 transition-all" />
            </button>

            {/* Option 5: Instant Demo Agent */}
            <button
              onClick={connectDemoWallet}
              disabled={isConnecting}
              className="w-full flex items-center justify-between p-3 rounded-xl bg-gradient-to-r from-cyan-950/40 to-blue-950/40 hover:from-cyan-900/50 hover:to-blue-900/50 border border-cyan-500/30 hover:border-cyan-400 transition-all text-left group"
            >
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-cyan-500/20 border border-cyan-400/30 flex items-center justify-center text-cyan-300">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-cyan-200 flex items-center gap-1.5">
                    Instant Demo Agent
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-mono font-bold">15 USDC</span>
                  </div>
                  <div className="text-[11px] text-slate-400">Zero-setup test wallet with 0 EGLD gas fees</div>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-cyan-400 group-hover:translate-x-0.5 transition-all" />
            </button>
          </div>
        )}

        {/* Footer info */}
        <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400 font-mono">
          <span>Network: Devnet (multiversx:D)</span>
          <span>Relayed V3 Gasless</span>
        </div>
      </div>
    </div>
  );
};
