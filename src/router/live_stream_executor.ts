import { ProviderSpec, ClawChatRequest } from "./types.js";
import { GeminiProvider } from "../gateway/gemini_provider.js";

export function createLiveStreamExecutor(options?: {
  geminiApiKey?: string;
  groqApiKey?: string;
  togetherApiKey?: string;
  deepinfraApiKey?: string;
  cerebrasApiKey?: string;
  openaiApiKey?: string;
  geminiProvider?: GeminiProvider;
  fetchFn?: typeof fetch;
  secondaryFallbackExecutor?: (
    provider: ProviderSpec,
    request: ClawChatRequest,
    signal: AbortSignal
  ) => AsyncIterable<string>;
}) {
  const geminiProvider =
    options?.geminiProvider ??
    new GeminiProvider(options?.geminiApiKey || process.env.GEMINI_API_KEY);
  const fetchFn = options?.fetchFn ?? fetch;
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
      provider.id.includes("gemini") ||
      request.model.toLowerCase().includes("gemini") ||
      provider.name.toLowerCase().includes("gemini");

    if (isGemini && geminiProvider.isAvailable()) {
      const geminiModel = request.model.toLowerCase().includes("gemini")
        ? request.model.replace(/^google\//, "")
        : "gemini-2.5-flash-lite";
      for await (const chunk of geminiProvider.streamCompletion(request.messages, {
        model: geminiModel,
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

    // If key is available, execute real OpenAI-compatible streaming with mid-stream buffering & deduplication
    if (apiKey && endpoint) {
      let emittedText = "";
      try {
        const response = await fetchFn(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: request.model,
            messages: request.messages,
            max_tokens: request.max_tokens,
            temperature: request.temperature,
            stream: true,
            ...(request.tools ? { tools: request.tools } : {}),
            ...(request.tool_choice ? { tool_choice: request.tool_choice } : {}),
            ...(request.response_format ? { response_format: request.response_format } : {}),
          }),
          signal,
        });

        if (!response.ok || !response.body) {
          const errText = await response.text().catch(() => "");
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
                  emittedText += content;
                  yield content;
                }
              } catch {
                // Ignore partial JSON
              }
            }
          }
        }
        return;
      } catch (streamErr: unknown) {
        // Fallback with deduplication if secondary fallback provider or Gemini is available
        if (options?.secondaryFallbackExecutor) {
          let fallbackAccumulated = "";
          let prefixTrimmed = emittedText.length === 0;

          for await (const chunk of options.secondaryFallbackExecutor(provider, request, signal)) {
            if (!prefixTrimmed) {
              fallbackAccumulated += chunk;
              if (fallbackAccumulated.length > emittedText.length) {
                if (fallbackAccumulated.startsWith(emittedText)) {
                  const delta = fallbackAccumulated.slice(emittedText.length);
                  prefixTrimmed = true;
                  if (delta.length > 0) yield delta;
                } else {
                  let i = 0;
                  const max = Math.min(emittedText.length, fallbackAccumulated.length);
                  while (i < max && emittedText[i] === fallbackAccumulated[i]) i++;
                  const delta = fallbackAccumulated.slice(i);
                  prefixTrimmed = true;
                  if (delta.length > 0) yield delta;
                }
              }
            } else {
              yield chunk;
            }
          }

          if (!prefixTrimmed && fallbackAccumulated.length > 0) {
            let i = 0;
            const max = Math.min(emittedText.length, fallbackAccumulated.length);
            while (i < max && emittedText[i] === fallbackAccumulated[i]) i++;
            const delta = fallbackAccumulated.slice(i);
            if (delta.length > 0) yield delta;
          }
          return;
        } else if (geminiProvider.isAvailable() && !isGemini) {
          let fallbackAccumulated = "";
          let prefixTrimmed = emittedText.length === 0;

          for await (const chunk of geminiProvider.streamCompletion(request.messages, {
            model: "gemini-2.5-flash-lite",
            maxTokens: request.max_tokens,
            signal,
          })) {
            if (!chunk.text) continue;
            if (!prefixTrimmed) {
              fallbackAccumulated += chunk.text;
              if (fallbackAccumulated.length > emittedText.length) {
                if (fallbackAccumulated.startsWith(emittedText)) {
                  const delta = fallbackAccumulated.slice(emittedText.length);
                  prefixTrimmed = true;
                  if (delta.length > 0) yield delta;
                } else {
                  let i = 0;
                  const max = Math.min(emittedText.length, fallbackAccumulated.length);
                  while (i < max && emittedText[i] === fallbackAccumulated[i]) i++;
                  const delta = fallbackAccumulated.slice(i);
                  prefixTrimmed = true;
                  if (delta.length > 0) yield delta;
                }
              }
            } else {
              yield chunk.text;
            }
          }

          if (!prefixTrimmed && fallbackAccumulated.length > 0) {
            let i = 0;
            const max = Math.min(emittedText.length, fallbackAccumulated.length);
            while (i < max && emittedText[i] === fallbackAccumulated[i]) i++;
            const delta = fallbackAccumulated.slice(i);
            if (delta.length > 0) yield delta;
          }
          return;
        }

        // If no secondary provider available, rethrow error
        throw streamErr;
      }
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
