import { describe, it, expect } from "vitest";
import { BotClassifier } from "../../src/tollbooth/bot_classifier.js";

describe("BotClassifier (TDD)", () => {
  const classifier = new BotClassifier();

  it("should classify known AI crawlers and bots as bot traffic", () => {
    const knownBots = [
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
      "Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)",
      "Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
      "Bytespider; spider-feedback@bytedance.com",
      "python-requests/2.31.0",
      "axios/1.6.0",
      "node-fetch/1.0",
    ];

    for (const ua of knownBots) {
      const result = classifier.classify({ "user-agent": ua });
      expect(result.isBot).toBe(true);
    }
  });

  it("should classify standard human desktop browsers as human traffic", () => {
    const humanUa =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

    const result = classifier.classify({
      "user-agent": humanUa,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "sec-ch-ua": '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
      cookie: "session_id=abc1234",
    });

    expect(result.isBot).toBe(false);
  });

  it("should classify requests explicitly accepting text/markdown as bot/agent traffic", () => {
    const result = classifier.classify({
      "user-agent": "CustomClient/1.0",
      accept: "text/markdown",
    });

    expect(result.isBot).toBe(true);
    expect(result.preferredContentType).toBe("text/markdown");
  });

  it("should extract X-Agent-Identity header if present", () => {
    const result = classifier.classify({
      "user-agent": "OpenClaw-Bot/1.0",
      "x-agent-identity": "84",
    });

    expect(result.isBot).toBe(true);
    expect(result.agentIdentity).toBe(84);
  });
});
