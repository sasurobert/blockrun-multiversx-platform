import dns from "node:dns/promises";
import crypto from "crypto";

export interface PublisherChallenge {
  domain: string;
  publisherAddress: string;
  challengeToken: string;
  dnsRecordName: string;
  dnsExpectedValue: string;
  metaTagHtml: string;
  expiresAt: number;
}

export interface DomainVerificationResult {
  verified: boolean;
  domain: string;
  publisherAddress: string;
  method: "dns" | "meta" | "none";
  details: string;
  timestamp: number;
}

export class PublisherVerifier {
  private challenges = new Map<string, PublisherChallenge>();
  private verifiedDomains = new Map<string, { publisherAddress: string; verifiedAt: number }>();
  private customResolver?: (domain: string) => Promise<string[][]>;
  private customFetcher?: (url: string) => Promise<string>;

  constructor(options?: {
    customResolver?: (domain: string) => Promise<string[][]>;
    customFetcher?: (url: string) => Promise<string>;
  }) {
    this.customResolver = options?.customResolver;
    this.customFetcher = options?.customFetcher;
  }

  public createChallenge(domain: string, publisherAddress: string): PublisherChallenge {
    const cleanDomain = domain.toLowerCase().replace(/^(https?:\/\/)?/, "").replace(/\/.*$/, "");
    const token = `x402_verify_${crypto
      .createHash("sha256")
      .update(`${cleanDomain}:${publisherAddress}:${Date.now()}:${crypto.randomBytes(8).toString("hex")}`)
      .digest("hex")
      .slice(0, 32)}`;

    const challenge: PublisherChallenge = {
      domain: cleanDomain,
      publisherAddress,
      challengeToken: token,
      dnsRecordName: `_x402-challenge.${cleanDomain}`,
      dnsExpectedValue: `x402-verification=${token}`,
      metaTagHtml: `<meta name="x402-verification" content="${token}">`,
      expiresAt: Date.now() + 86400_000, // 24 hours
    };

    this.challenges.set(`${cleanDomain}:${publisherAddress}`, challenge);
    return challenge;
  }

  public async verifyDnsTxt(domain: string, publisherAddress: string): Promise<boolean> {
    const cleanDomain = domain.toLowerCase().replace(/^(https?:\/\/)?/, "").replace(/\/.*$/, "");
    const challenge = this.challenges.get(`${cleanDomain}:${publisherAddress}`);
    const expectedToken = challenge?.challengeToken;
    const lookupHost = `_x402-challenge.${cleanDomain}`;

    try {
      const records = this.customResolver
        ? await this.customResolver(lookupHost)
        : await dns.resolveTxt(lookupHost);
      const flatRecords = records.flat();
      return flatRecords.some((txt) => {
        if (expectedToken && txt.includes(expectedToken)) return true;
        if (txt.includes(`x402-publisher=${publisherAddress}`)) return true;
        if (txt.includes(`multiversx-publisher=${publisherAddress}`)) return true;
        return false;
      });
    } catch {
      return false;
    }
  }

  public async verifyMetaTag(domain: string, publisherAddress: string): Promise<boolean> {
    const cleanDomain = domain.toLowerCase().replace(/^(https?:\/\/)?/, "").replace(/\/.*$/, "");
    const challenge = this.challenges.get(`${cleanDomain}:${publisherAddress}`);
    const expectedToken = challenge?.challengeToken;
    const targetUrl = `https://${cleanDomain}`;

    try {
      let html = "";
      if (this.customFetcher) {
        html = await this.customFetcher(targetUrl);
      } else {
        const resp = await fetch(targetUrl, {
          signal: AbortSignal.timeout(5000),
          headers: { "User-Agent": "x402-Publisher-Verifier/1.0" },
        });
        html = await resp.text();
      }

      if (expectedToken && (html.includes(expectedToken) || html.includes(`content="${expectedToken}"`))) {
        return true;
      }
      if (html.includes(publisherAddress)) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  public async verifyDomain(
    domain: string,
    publisherAddress: string,
    method: "dns" | "meta" | "auto" = "auto"
  ): Promise<DomainVerificationResult> {
    const cleanDomain = domain.toLowerCase().replace(/^(https?:\/\/)?/, "").replace(/\/.*$/, "");

    if (method === "dns" || method === "auto") {
      const dnsOk = await this.verifyDnsTxt(cleanDomain, publisherAddress);
      if (dnsOk) {
        this.verifiedDomains.set(cleanDomain, { publisherAddress, verifiedAt: Date.now() });
        return {
          verified: true,
          domain: cleanDomain,
          publisherAddress,
          method: "dns",
          details: `Verified via DNS TXT record at _x402-challenge.${cleanDomain}`,
          timestamp: Date.now(),
        };
      }
    }

    if (method === "meta" || method === "auto") {
      const metaOk = await this.verifyMetaTag(cleanDomain, publisherAddress);
      if (metaOk) {
        this.verifiedDomains.set(cleanDomain, { publisherAddress, verifiedAt: Date.now() });
        return {
          verified: true,
          domain: cleanDomain,
          publisherAddress,
          method: "meta",
          details: `Verified via HTML meta tag on https://${cleanDomain}`,
          timestamp: Date.now(),
        };
      }
    }

    return {
      verified: false,
      domain: cleanDomain,
      publisherAddress,
      method: "none",
      details: "Verification challenge not found in DNS TXT or HTML meta tags",
      timestamp: Date.now(),
    };
  }

  public isDomainVerified(domain: string, publisherAddress?: string): boolean {
    const cleanDomain = domain.toLowerCase().replace(/^(https?:\/\/)?/, "").replace(/\/.*$/, "");
    const entry = this.verifiedDomains.get(cleanDomain);
    if (!entry) return false;
    if (publisherAddress && entry.publisherAddress !== publisherAddress) return false;
    return true;
  }
}
