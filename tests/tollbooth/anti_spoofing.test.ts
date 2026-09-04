import { describe, it, expect } from "vitest";
import {
  BotClassifier,
  ipMatchesCidr,
  checkBotCidr,
  verifyBotDns,
} from "../../src/tollbooth/bot_classifier.js";

describe("Tollbooth Bot Anti-Spoofing & FCrDNS Verification (TDD)", () => {
  it("should correctly match IPv4 subnets using ipMatchesCidr", () => {
    expect(ipMatchesCidr("20.15.240.65", "20.15.240.64/28")).toBe(true);
    expect(ipMatchesCidr("20.15.240.79", "20.15.240.64/28")).toBe(true);
    expect(ipMatchesCidr("20.15.240.80", "20.15.240.64/28")).toBe(false);

    expect(ipMatchesCidr("66.249.64.10", "66.249.64.0/19")).toBe(true);
    expect(ipMatchesCidr("198.181.160.5", "198.181.160.0/22")).toBe(true);
    expect(ipMatchesCidr("1.1.1.1", "198.181.160.0/22")).toBe(false);
  });

  it("should verify authentic bot IP via checkBotCidr", () => {
    expect(checkBotCidr("20.15.240.68", "openai")).toBe(true);
    expect(checkBotCidr("160.79.104.5", "anthropic")).toBe(true);
    expect(checkBotCidr("198.181.160.100", "perplexity")).toBe(true);
    expect(checkBotCidr("66.249.64.1", "google")).toBe(true);
    expect(checkBotCidr("192.0.2.1", "openai")).toBe(false);
  });

  it("should verify bot identity via mock RFC-compliant FCrDNS resolver", async () => {
    const mockReverse = async (ip: string) => {
      if (ip === "203.0.113.195") {
        return ["crawl-203-0-113-195.openai.com"];
      }
      return ["unrelated-host.net"];
    };

    const mockForwardValid = async (hostname: string) => {
      if (hostname === "crawl-203-0-113-195.openai.com") {
        return ["203.0.113.195"];
      }
      return ["1.2.3.4"];
    };

    const mockForwardMismatch = async (_hostname: string) => {
      return ["198.51.100.22"]; // Mismatch forward IP
    };

    // Valid forward-confirmed reverse DNS
    const resValid = await verifyBotDns("203.0.113.195", "openai", mockReverse, mockForwardValid);
    expect(resValid.verified).toBe(true);
    expect(resValid.hostname).toBe("crawl-203-0-113-195.openai.com");

    // Forward mismatch must reject
    const resMismatch = await verifyBotDns("203.0.113.195", "openai", mockReverse, mockForwardMismatch);
    expect(resMismatch.verified).toBe(false);
  });

  it("should flag spoofed user agents in BotClassifier.verifyBot", async () => {
    const classifier = new BotClassifier();

    // Legitimate OpenAI IP
    const validResult = await classifier.verifyBot(
      { "user-agent": "Mozilla/5.0 AppleWebKit (compatible; GPTBot/1.2; +https://openai.com/gptbot)" },
      "20.15.240.68"
    );
    expect(validResult.isBot).toBe(true);
    expect(validResult.isSpoofed).toBe(false);
    expect(validResult.verificationStatus).toBe("verified");

    // Spoofed IP claiming to be ClaudeBot
    const spoofedResult = await classifier.verifyBot(
      { "user-agent": "ClaudeBot/1.0 (+https://anthropic.com/claudebot)" },
      "203.0.113.50", // Unregistered public IP
      async () => ["attacker.hacker.com"]
    );
    expect(spoofedResult.isBot).toBe(true);
    expect(spoofedResult.isSpoofed).toBe(true);
    expect(spoofedResult.verificationStatus).toBe("spoofed");
  });

  it("should safely reject malformed IP addresses and invalid CIDR masks", () => {
    expect(ipMatchesCidr("not.an.ip.address", "0.0.0.0/0")).toBe(false);
    expect(ipMatchesCidr("1.2.3.999", "1.2.3.0/24")).toBe(false);
    expect(ipMatchesCidr("1.2.3.4", "1.2.3.0/35")).toBe(false);
    expect(ipMatchesCidr("", "1.2.3.0/24")).toBe(false);
    expect(ipMatchesCidr("1.2.3.4", "")).toBe(false);
    expect(ipMatchesCidr("1.2.3.4", "invalid_cidr")).toBe(false);
  });
});

