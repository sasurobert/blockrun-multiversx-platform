import {
  ipMatchesCidr,
  checkBotCidr,
  verifyBotDns,
  KNOWN_BOT_CIDRS,
  KNOWN_BOT_DOMAINS,
  BotClassifier,
} from "./bot_classifier.js";

export {
  ipMatchesCidr,
  checkBotCidr,
  verifyBotDns,
  KNOWN_BOT_CIDRS,
  KNOWN_BOT_DOMAINS,
  BotClassifier,
};

export interface BotCidrFeedConfig {
  url: string;
  parser?: (data: any) => string[];
}

export const OFFICIAL_BOT_FEEDS: Record<string, BotCidrFeedConfig> = {
  openai: {
    url: "https://openai.com/gptbot.json",
    parser: (data) => {
      if (Array.isArray(data?.prefixes)) {
        return data.prefixes
          .map((p: any) => p.ipv4Prefix || p.ipv6Prefix)
          .filter(Boolean);
      }
      return [];
    },
  },
  google: {
    url: "https://developers.google.com/search/apis/ipranges/googlebot.json",
    parser: (data) => {
      if (Array.isArray(data?.prefixes)) {
        return data.prefixes
          .map((p: any) => p.ipv4Prefix || p.ipv6Prefix)
          .filter(Boolean);
      }
      return [];
    },
  },
};

/**
 * Dynamic Bot CIDR Range Ingestion Daemon that fetches official crawler IP range feeds
 * (e.g. OpenAI GPTBot feed, Googlebot feed) with robust local fallback.
 */
export class BotCidrFeedIngestionDaemon {
  private activeCidrs: Map<string, string[]> = new Map();
  private timer: NodeJS.Timeout | null = null;
  private fetchFn: (url: string, init?: RequestInit) => Promise<globalThis.Response>;

  constructor(options?: {
    customFeeds?: Record<string, BotCidrFeedConfig>;
    fetchFn?: (url: string, init?: RequestInit) => Promise<globalThis.Response>;
  }) {
    this.fetchFn = options?.fetchFn || (globalThis.fetch as any);
    // Seed with known local fallback CIDRs
    for (const [family, cidrs] of Object.entries(KNOWN_BOT_CIDRS)) {
      this.activeCidrs.set(family, [...cidrs]);
    }
  }

  public getBotCidrs(botFamily: string): string[] {
    return this.activeCidrs.get(botFamily) || KNOWN_BOT_CIDRS[botFamily] || [];
  }

  public async fetchFeedForBot(
    botFamily: string,
    feedConfig?: BotCidrFeedConfig
  ): Promise<{ success: boolean; count: number; cidrs: string[]; fromFallback: boolean }> {
    const config = feedConfig || OFFICIAL_BOT_FEEDS[botFamily];
    if (!config) {
      const fallback = this.getBotCidrs(botFamily);
      return {
        success: false,
        count: fallback.length,
        cidrs: fallback,
        fromFallback: true,
      };
    }

    try {
      const resp = await this.fetchFn(config.url, {
        signal: AbortSignal.timeout(5000),
        headers: { "User-Agent": "x402-Tollbooth-CIDR-Daemon/1.0" },
      });

      if (!resp.ok) {
        throw new Error(`Feed HTTP ${resp.status}`);
      }

      const json = await resp.json();
      const parsed = config.parser ? config.parser(json) : (Array.isArray(json) ? json : []);
      if (parsed.length > 0) {
        const existing = this.activeCidrs.get(botFamily) || [];
        const merged = Array.from(new Set([...existing, ...parsed]));
        this.activeCidrs.set(botFamily, merged);
        return { success: true, count: merged.length, cidrs: merged, fromFallback: false };
      }
    } catch {
      // Gracefully fall back to local known CIDRs on network failure / offline mode
    }

    const fallback = this.getBotCidrs(botFamily);
    return {
      success: false,
      count: fallback.length,
      cidrs: fallback,
      fromFallback: true,
    };
  }

  public async refreshAll(): Promise<Record<string, { count: number; fromFallback: boolean }>> {
    const results: Record<string, { count: number; fromFallback: boolean }> = {};
    for (const family of Object.keys(OFFICIAL_BOT_FEEDS)) {
      const res = await this.fetchFeedForBot(family);
      results[family] = { count: res.count, fromFallback: res.fromFallback };
    }
    return results;
  }

  public startDaemon(intervalMs = 3600_000): void {
    if (this.timer) return;
    this.refreshAll().catch(() => {});
    this.timer = setInterval(() => {
      this.refreshAll().catch(() => {});
    }, intervalMs);
  }

  public stopDaemon(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export const globalBotCidrDaemon = new BotCidrFeedIngestionDaemon();
