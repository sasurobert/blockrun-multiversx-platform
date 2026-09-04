import dns from "node:dns/promises";
import { BotClassificationResult } from "./types.js";

export const KNOWN_BOT_CIDRS: Record<string, string[]> = {
  openai: [
    "20.15.240.64/28",
    "20.15.240.80/28",
    "20.15.240.96/28",
    "20.15.240.112/28",
    "23.98.142.176/28",
    "40.84.180.128/28",
    "52.230.152.0/24",
    "52.233.106.0/24",
  ],
  anthropic: [
    "160.79.104.0/23",
  ],
  perplexity: [
    "198.181.160.0/22",
  ],
  google: [
    "66.249.64.0/19",
    "66.102.0.0/20",
    "64.233.160.0/19",
  ],
};

export const KNOWN_BOT_DOMAINS: Record<string, RegExp[]> = {
  openai: [/\.openai\.com$/i],
  anthropic: [/\.anthropic\.com$/i, /\.claude\.ai$/i],
  perplexity: [/\.perplexity\.ai$/i],
  google: [/\.googlebot\.com$/i, /\.google\.com$/i],
};

/**
 * Checks whether an IPv4 address falls within a given CIDR subnet.
 */
export function ipMatchesCidr(ip: string, cidr: string): boolean {
  if (!ip || !cidr) return false;
  const cleanIp = ip.replace(/^::ffff:/i, "").trim();
  const [range, bitsStr] = cidr.split("/");
  if (!range || bitsStr === undefined) return false;
  const bits = parseInt(bitsStr, 10);
  if (isNaN(bits) || bits < 0 || bits > 32) return false;

  const ipParts = cleanIp.split(".").map(Number);
  const rangeParts = range.split(".").map(Number);
  if (ipParts.length !== 4 || rangeParts.length !== 4) return false;
  if (ipParts.some((p) => isNaN(p) || !Number.isInteger(p) || p < 0 || p > 255)) return false;
  if (rangeParts.some((p) => isNaN(p) || !Number.isInteger(p) || p < 0 || p > 255)) return false;

  const ipNum = ((ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3]) >>> 0;
  const rangeNum = ((rangeParts[0] << 24) | (rangeParts[1] << 16) | (rangeParts[2] << 8) | rangeParts[3]) >>> 0;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;

  return (ipNum & mask) === (rangeNum & mask);
}

/**
 * Validates whether an IP belongs to a bot family using CIDR matching.
 */
export function checkBotCidr(
  ip: string,
  botFamily: string,
  daemon?: { getBotCidrs: (fam: string) => string[] }
): boolean {
  const cidrs = daemon ? daemon.getBotCidrs(botFamily) : KNOWN_BOT_CIDRS[botFamily];
  if (!cidrs) return false;
  return cidrs.some((cidr) => ipMatchesCidr(ip, cidr));
}

/**
 * RFC-compliant Forward-Confirmed Reverse DNS (FCrDNS) verification helper.
 */
export async function verifyBotDns(
  ip: string,
  botFamily: "openai" | "anthropic" | "perplexity" | "google",
  customResolver?: (ip: string) => Promise<string[]>,
  customForwardResolver?: (hostname: string) => Promise<string[]>,
  options?: { allowLocalhostBypass?: boolean }
): Promise<{ verified: boolean; hostname?: string }> {
  const cleanIp = ip.replace(/^::ffff:/i, "").trim();
  const allowBypass = options?.allowLocalhostBypass ?? (process.env.NODE_ENV === "test");
  if (
    allowBypass &&
    (cleanIp === "127.0.0.1" || cleanIp === "::1" || cleanIp === "localhost")
  ) {
    return { verified: true, hostname: `loopback.${botFamily}.mock` };
  }

  try {
    const hostnames = customResolver ? await customResolver(cleanIp) : await dns.reverse(cleanIp);
    const domainPatterns = KNOWN_BOT_DOMAINS[botFamily] || [];
    for (const hostname of hostnames) {
      if (domainPatterns.some((pattern) => pattern.test(hostname))) {
        try {
          const forwardIps = customForwardResolver
            ? await customForwardResolver(hostname)
            : await dns.resolve4(hostname);
          if (forwardIps.includes(cleanIp)) {
            return { verified: true, hostname };
          }
        } catch {
          return { verified: false, hostname };
        }
      }
    }
    return { verified: false, hostname: hostnames[0] };
  } catch {
    return { verified: false };
  }
}

const BOT_USER_AGENTS = [
  /claudebot/i,
  /gptbot/i,
  /chatgpt-user/i,
  /perplexitybot/i,
  /bytespider/i,
  /google-extended/i,
  /anthropic-ai/i,
  /cohere-ai/i,
  /omgili/i,
  /diffbot/i,
  /facebookexternalhit/i,
  /python-requests/i,
  /python-urllib/i,
  /aiohttp/i,
  /httpx/i,
  /axios/i,
  /node-fetch/i,
  /got\//i,
  /curl\//i,
  /wget\//i,
  /scrapy/i,
  /headlesschrome/i,
  /puppeteer/i,
  /playwright/i,
  /selenium/i,
  /openclaw/i,
  /blockrun/i,
];

export class BotClassifier {
  private dnsCache = new Map<string, { verified: boolean; hostname?: string; timestamp: number }>();
  private cacheTtlMs: number = 300_000; // 5 minutes
  private cidrDaemon?: { getBotCidrs: (fam: string) => string[] };

  constructor(options?: { cacheTtlMs?: number; cidrDaemon?: { getBotCidrs: (fam: string) => string[] } }) {
    this.cacheTtlMs = options?.cacheTtlMs ?? 300_000;
    this.cidrDaemon = options?.cidrDaemon;
  }

  public classify(
    headers: Record<string, string | string[] | undefined>,
    clientIp?: string
  ): BotClassificationResult {
    const getHeader = (key: string): string => {
      const val = headers[key] || headers[key.toLowerCase()];
      if (Array.isArray(val)) return val.join(", ");
      return val ?? "";
    };

    const ua = getHeader("user-agent");
    const accept = getHeader("accept");
    const agentIdHeader = getHeader("x-agent-identity");

    let agentIdentity: number | undefined;
    if (agentIdHeader && /^\d+$/.test(agentIdHeader.trim())) {
      agentIdentity = parseInt(agentIdHeader.trim(), 10);
    }

    let preferredContentType: "text/markdown" | "application/json" | "text/html" = "text/html";
    if (accept.includes("text/markdown")) {
      preferredContentType = "text/markdown";
    } else if (accept.includes("application/json")) {
      preferredContentType = "application/json";
    }

    // Check if explicitly requesting markdown or providing agent identity
    if (preferredContentType === "text/markdown" || agentIdentity !== undefined) {
      return {
        isBot: true,
        botName: ua || "Autonomous-Agent",
        preferredContentType,
        agentIdentity,
        clientIp,
        verificationStatus: "unverified",
      };
    }

    // Check known bot regex
    for (const regex of BOT_USER_AGENTS) {
      if (regex.test(ua)) {
        return {
          isBot: true,
          botName: ua,
          preferredContentType,
          agentIdentity,
          clientIp,
          verificationStatus: "unverified",
        };
      }
    }

    // If no cookies, simple accept, missing sec-ch-ua, check if suspicious
    const hasCookies = !!getHeader("cookie");
    const hasSecChUa = !!getHeader("sec-ch-ua");
    if (!hasCookies && !hasSecChUa && ua.toLowerCase().includes("bot")) {
      return {
        isBot: true,
        botName: ua,
        preferredContentType,
        agentIdentity,
        clientIp,
        verificationStatus: "unverified",
      };
    }

    return {
      isBot: false,
      preferredContentType: "text/html",
      agentIdentity,
      clientIp,
      verificationStatus: "unknown",
    };
  }

  /**
   * Performs deep anti-spoofing verification for major AI crawler families.
   */
  public async verifyBot(
    headers: Record<string, string | string[] | undefined>,
    clientIp?: string,
    customDnsResolver?: (ip: string) => Promise<string[]>,
    customForwardResolver?: (hostname: string) => Promise<string[]>
  ): Promise<BotClassificationResult> {
    const basic = this.classify(headers, clientIp);
    if (!basic.isBot || !clientIp || !basic.botName) {
      return basic;
    }

    const ua = basic.botName.toLowerCase();
    let family: "openai" | "anthropic" | "perplexity" | "google" | undefined;

    if (ua.includes("gptbot") || ua.includes("chatgpt")) {
      family = "openai";
    } else if (ua.includes("claudebot") || ua.includes("anthropic")) {
      family = "anthropic";
    } else if (ua.includes("perplexitybot")) {
      family = "perplexity";
    } else if (ua.includes("googlebot") || ua.includes("google-extended")) {
      family = "google";
    }

    if (!family) {
      // Not a Tier-1 crawler requiring strict anti-spoofing
      return {
        ...basic,
        verificationStatus: "unverified",
        isSpoofed: false,
      };
    }

    // 1. Fast path: CIDR match
    if (checkBotCidr(clientIp, family, this.cidrDaemon)) {
      return {
        ...basic,
        verificationStatus: "verified",
        isSpoofed: false,
      };
    }

    // 2. Cache check
    const cacheKey = `${family}:${clientIp}`;
    const cached = this.dnsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      return {
        ...basic,
        verificationStatus: cached.verified ? "verified" : "spoofed",
        isSpoofed: !cached.verified,
      };
    }

    // 3. FCrDNS Verification
    const dnsResult = await verifyBotDns(clientIp, family, customDnsResolver, customForwardResolver);
    this.dnsCache.set(cacheKey, {
      verified: dnsResult.verified,
      hostname: dnsResult.hostname,
      timestamp: Date.now(),
    });

    return {
      ...basic,
      verificationStatus: dnsResult.verified ? "verified" : "spoofed",
      isSpoofed: !dnsResult.verified,
    };
  }
}
