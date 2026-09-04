import { ProviderSpec, ClawChatRequest } from "./types.js";
import { GeminiProvider } from "../gateway/gemini_provider.js";

export function createLiveStreamExecutor(options?: {
  geminiApiKey?: string;
  groqApiKey?: string;
  togetherApiKey?: string;
  deepinfraApiKey?: string;
  cerebrasApiKey?: string;
  openaiApiKey?: string;
}) {
  const geminiProvider = new GeminiProvider(
    options?.geminiApiKey || process.env.GEMINI_API_KEY
  );
  const groqApiKey = options?.groqApiKey || process.env.GROQ_API_KEY;
  const togetherApiKey =
    options?.togetherApiKey || process.env.TOGETHER_API_KEY || process.env.TOGETHER_AI_API_KEY;
  const deepinfraApiKey = options?.deepinfraApiKey || process.env.DEEPINFRA_API_KEY;
  const cerebrasApiKey = options?.cerebrasApiKey || process.env.CEREBRAS_API_KEY;
  const openaiApiKey = options?.openaiApiKey || process.env.OPENAI_API_KEY;

  return async function* liveStreamExecutor(
    provider: ProviderSpec,
    request: ClawChatRequest,
    signal: AbortSignal
  ): AsyncIterable<string> {
    const isGemini =
      provider.id === "gemini" ||
      provider.id === "google" ||
      request.model.includes("gemini") ||
      provider.name.toLowerCase().includes("gemini");

    if (isGemini && geminiProvider.isAvailable()) {
      for await (const chunk of geminiProvider.streamCompletion(request.messages, {
        model: request.model,
        maxTokens: request.max_tokens,
        signal,
      })) {
        if (chunk.text) {
          yield chunk.text;
        }
      }
      return;
    }

    // Determine upstream endpoint & key for OpenAI-compatible providers
    let endpoint = provider.endpoint;
    let apiKey = "";

    if (provider.id.includes("groq") || provider.name.toLowerCase().includes("groq")) {
      apiKey = groqApiKey || "";
      endpoint = endpoint || "https://api.groq.com/openai/v1/chat/completions";
    } else if (provider.id.includes("together") || provider.name.toLowerCase().includes("together")) {
      apiKey = togetherApiKey || "";
      endpoint = endpoint || "https://api.together.xyz/v1/chat/completions";
    } else if (provider.id.includes("deepinfra") || provider.name.toLowerCase().includes("deepinfra")) {
      apiKey = deepinfraApiKey || "";
      endpoint = endpoint || "https://api.deepinfra.com/v1/openai/chat/completions";
    } else if (provider.id.includes("cerebras") || provider.name.toLowerCase().includes("cerebras")) {
      apiKey = cerebrasApiKey || "";
      endpoint = endpoint || "https://api.cerebras.ai/v1/chat/completions";
    } else if (provider.id.includes("openai") || provider.name.toLowerCase().includes("openai")) {
      apiKey = openaiApiKey || "";
      endpoint = endpoint || "https://api.openai.com/v1/chat/completions";
    }

    // If key is available, execute real OpenAI-compatible streaming
    if (apiKey && endpoint) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          max_tokens: request.max_tokens,
          stream: true,
        }),
        signal,
      });

      if (!response.ok || !response.body) {
        const errText = await response.text();
        throw new Error(`${provider.name} API error (${response.status}): ${errText}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("data:")) {
            const dataStr = trimmed.slice(5).trim();
            if (dataStr === "[DONE]") return;
            try {
              const parsed = JSON.parse(dataStr);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                yield content;
              }
            } catch {
              // Ignore partial JSON
            }
          }
        }
      }
      return;
    }

    // Fallback: If no provider-specific key was configured or endpoint wasn't reached,
    // and Gemini is available, use Gemini as the live upstream provider!
    if (geminiProvider.isAvailable()) {
      for await (const chunk of geminiProvider.streamCompletion(request.messages, {
        model: "gemini-2.5-flash-lite",
        maxTokens: request.max_tokens,
        signal,
      })) {
        if (chunk.text) {
          yield chunk.text;
        }
      }
      return;
    }

    throw new Error(`No live AI provider configured for ${provider.name} (model: ${request.model})`);
  };
}
