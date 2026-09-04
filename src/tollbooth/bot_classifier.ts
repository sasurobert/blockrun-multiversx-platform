import { BotClassificationResult } from "./types.js";

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
  public classify(headers: Record<string, string | string[] | undefined>): BotClassificationResult {
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
      };
    }

    return {
      isBot: false,
      preferredContentType: "text/html",
      agentIdentity,
    };
  }
}
