import { describe, it, expect } from "vitest";
import { createLiveStreamExecutor } from "../../src/router/live_stream_executor.js";
import { ProviderSpec, ClawChatRequest } from "../../src/router/types.js";

describe("createLiveStreamExecutor (Hardened Mid-Stream Deduplication)", () => {
  const provider: ProviderSpec = {
    id: "test-groq",
    name: "Groq LPU",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    costPerMillionInputTokensUsd: 0.5,
    costPerMillionOutputTokensUsd: 0.8,
    avgTtftMs: 95,
    tokensPerSecond: 280,
    healthy: true,
    supportedModels: ["llama-3.3-70b"],
  };

  const request: ClawChatRequest = {
    model: "llama-3.3-70b",
    messages: [{ role: "user", content: "Say hello" }],
  };

  it("should stream chunks from upstream OpenAI-compatible provider", async () => {
    const sseLines = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world!"}}]}\n\n',
      "data: [DONE]\n\n",
    ];

    const mockFetch: typeof fetch = async () => {
      const stream = new ReadableStream({
        start(controller) {
          for (const line of sseLines) {
            controller.enqueue(new TextEncoder().encode(line));
          }
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    };

    const executor = createLiveStreamExecutor({
      groqApiKey: "mock-groq-key",
      fetchFn: mockFetch,
    });

    const chunks: string[] = [];
    for await (const chunk of executor(provider, request, new AbortController().signal)) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["Hello", " world!"]);
    expect(chunks.join("")).toBe("Hello world!");
  });

  it("should catch mid-stream failure, buffer chunks, and deduplicate fallback stream", async () => {
    // Upstream emits "The answer" and " is ", then crashes on next read
    let step = 0;
    const mockFetch: typeof fetch = async () => {
      const stream = new ReadableStream({
        pull(controller) {
          if (step === 0) {
            step++;
            controller.enqueue(
              new TextEncoder().encode('data: {"choices":[{"delta":{"content":"The answer"}}]}\n\n')
            );
          } else if (step === 1) {
            step++;
            controller.enqueue(
              new TextEncoder().encode('data: {"choices":[{"delta":{"content":" is "}}]}\n\n')
            );
          } else {
            controller.error(new Error("TCP connection reset by peer"));
          }
        },
      });
      return new Response(stream, { status: 200 });
    };

    const mockSecondary = async function* () {
      yield "The answer";
      yield " is 42";
      yield ", confirmed.";
    };

    const executor = createLiveStreamExecutor({
      groqApiKey: "mock-groq-key",
      fetchFn: mockFetch,
      secondaryFallbackExecutor: mockSecondary,
    });

    const chunks: string[] = [];
    for await (const chunk of executor(provider, request, new AbortController().signal)) {
      chunks.push(chunk);
    }

    expect(chunks.join("")).toBe("The answer is 42, confirmed.");
    expect(chunks).toEqual(["The answer", " is ", "42", ", confirmed."]);
  });

  it("should stream entire secondary fallback when primary crashes before yielding any chunks", async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response("Internal Server Error", { status: 500 });
    };

    const mockSecondary = async function* () {
      yield "Fallback ";
      yield "response";
    };

    const executor = createLiveStreamExecutor({
      groqApiKey: "mock-groq-key",
      fetchFn: mockFetch,
      secondaryFallbackExecutor: mockSecondary,
    });

    const chunks: string[] = [];
    for await (const chunk of executor(provider, request, new AbortController().signal)) {
      chunks.push(chunk);
    }

    expect(chunks.join("")).toBe("Fallback response");
  });

  it("should rethrow mid-stream error when no secondary fallback is configured", async () => {
    let step = 0;
    const mockFetch: typeof fetch = async () => {
      const stream = new ReadableStream({
        pull(controller) {
          if (step === 0) {
            step++;
            controller.enqueue(
              new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Part 1"}}]}\n\n')
            );
          } else {
            controller.error(new Error("Network disconnect"));
          }
        },
      });
      return new Response(stream, { status: 200 });
    };

    const executor = createLiveStreamExecutor({
      groqApiKey: "mock-groq-key",
      fetchFn: mockFetch,
    });

    const gen = executor(provider, request, new AbortController().signal);
    const chunks: string[] = [];

    await expect(async () => {
      for await (const chunk of gen) {
        chunks.push(chunk);
      }
    }).rejects.toThrow("Network disconnect");

    expect(chunks).toEqual(["Part 1"]);
  });
});
