import React, { createContext, useContext, useState, useEffect } from "react";

export type WalletType = "extension" | "xportal" | "webwallet" | "demo" | "pem" | null;

export interface WalletContextType {
  isConnected: boolean;
  address: string | null;
  egldBalance: string;
  usdcBalance: number;
  walletType: WalletType;
  isConnecting: boolean;
  isModalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
  connectExtension: () => Promise<void>;
  connectDemoWallet: () => void;
  connectWebWallet: () => void;
  connectXPortal: () => void;
  connectPemWallet: (pemContent: string) => { success: boolean; address?: string; error?: string };
  disconnect: () => void;
  refreshBalances: () => Promise<void>;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

const DEMO_AGENT_ADDRESS = "erd1n2tunlzeqdezy3nz4cdz0a2r056wlsrdew8atsmst7cpd2l0fjxqsgrc6a";
const DEVNET_API = "https://devnet-api.multiversx.com";
const USDC_TOKEN = "USDC-350c4e";

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [address, setAddress] = useState<string | null>(() => localStorage.getItem("mvx_wallet_address"));
  const [walletType, setWalletType] = useState<WalletType>(() => (localStorage.getItem("mvx_wallet_type") as WalletType) || null);
  const [egldBalance, setEgldBalance] = useState<string>("0.000000");
  const [usdcBalance, setUsdcBalance] = useState<number>(0);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);

  const refreshBalances = async (targetAddress?: string) => {
    const addr = targetAddress || address;
    if (!addr) return;

    try {
      // Fetch EGLD balance
      const accRes = await fetch(`${DEVNET_API}/accounts/${addr}`);
      if (accRes.ok) {
        const acc = await accRes.json();
        const egld = (Number(acc.balance || 0) / 1e18).toFixed(4);
        setEgldBalance(egld);
      }

      // Fetch USDC balance
      const tokensRes = await fetch(`${DEVNET_API}/accounts/${addr}/tokens`);
      if (tokensRes.ok) {
        const tokens = await tokensRes.json();
        const usdc = Array.isArray(tokens) ? tokens.find((t: any) => t.identifier === USDC_TOKEN) : null;
        if (usdc) {
          setUsdcBalance(Number(usdc.balance || 0) / 1e6);
        } else {
          setUsdcBalance(0);
        }
      }
    } catch {
      // fallback graceful
    }
  };

  useEffect(() => {
    if (address) {
      refreshBalances(address);
      const interval = setInterval(() => refreshBalances(address), 15000);
      return () => clearInterval(interval);
    }
  }, [address]);

  const connectDemoWallet = () => {
    setIsConnecting(true);
    setAddress(DEMO_AGENT_ADDRESS);
    setWalletType("demo");
    localStorage.setItem("mvx_wallet_address", DEMO_AGENT_ADDRESS);
    localStorage.setItem("mvx_wallet_type", "demo");
    refreshBalances(DEMO_AGENT_ADDRESS);
    setIsConnecting(false);
    setIsModalOpen(false);
  };

  const connectPemWallet = (pemContent: string) => {
    try {
      // Extract erd1 address from PEM header
      const match = pemContent.match(/BEGIN PRIVATE KEY for (erd1[a-z0-9]{58})/i) || pemContent.match(/(erd1[a-z0-9]{58})/i);
      if (!match || !match[1]) {
        return { success: false, error: "Invalid PEM format: No MultiversX address (erd1...) found in header." };
      }

      const extractedAddress = match[1].toLowerCase();
      setAddress(extractedAddress);
      setWalletType("pem");
      localStorage.setItem("mvx_wallet_address", extractedAddress);
      localStorage.setItem("mvx_wallet_type", "pem");
      refreshBalances(extractedAddress);
      setIsModalOpen(false);
      return { success: true, address: extractedAddress };
    } catch (err: any) {
      return { success: false, error: err?.message || "Failed to parse PEM file." };
    }
  };

  const connectExtension = async () => {
    setIsConnecting(true);
    try {
      const elrondWallet = (window as any).elrondWallet;
      if (!elrondWallet) {
        window.open("https://chrome.google.com/webstore/detail/multiversx-defi-wallet/dngmlblcodfobpdpecaadgfbcggfjfnm", "_blank");
        throw new Error("MultiversX DeFi Wallet extension not detected.");
      }

      const res = await elrondWallet.login();
      if (res && res.address) {
        setAddress(res.address);
        setWalletType("extension");
        localStorage.setItem("mvx_wallet_address", res.address);
        localStorage.setItem("mvx_wallet_type", "extension");
        refreshBalances(res.address);
        setIsModalOpen(false);
      }
    } catch (err: any) {
      console.warn("Extension login cancelled or not available:", err?.message || err);
    } finally {
      setIsConnecting(false);
    }
  };

  const connectWebWallet = () => {
    const callbackUrl = encodeURIComponent(window.location.href);
    window.location.href = `https://devnet-wallet.multiversx.com/hook/login?callbackUrl=${callbackUrl}`;
  };

  const connectXPortal = () => {
    const defaultAddr = "erd1tswfs5f472p88lhmge99l22e952m4sfe7307jugzz0578usqdnyqdf9cwj";
    setAddress(defaultAddr);
    setWalletType("xportal");
    localStorage.setItem("mvx_wallet_address", defaultAddr);
    localStorage.setItem("mvx_wallet_type", "xportal");
    refreshBalances(defaultAddr);
    setIsModalOpen(false);
  };

  const disconnect = () => {
    setAddress(null);
    setWalletType(null);
    setEgldBalance("0.000000");
    setUsdcBalance(0);
    localStorage.removeItem("mvx_wallet_address");
    localStorage.removeItem("mvx_wallet_type");
  };

  return (
    <WalletContext.Provider
      value={{
        isConnected: !!address,
        address,
        egldBalance,
        usdcBalance,
        walletType,
        isConnecting,
        isModalOpen,
        openModal: () => setIsModalOpen(true),
        closeModal: () => setIsModalOpen(false),
        connectExtension,
        connectDemoWallet,
        connectWebWallet,
        connectXPortal,
        connectPemWallet,
        disconnect,
        refreshBalances: () => refreshBalances(),
      }}
    >
      {children}
    </WalletContext.Provider>
  );
};

export const useWallet = (): WalletContextType => {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
};
