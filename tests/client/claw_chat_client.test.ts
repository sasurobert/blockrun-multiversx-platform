import { describe, it, expect, vi } from "vitest";
import { BlockRunMvxClient } from "../../src/client/blockrun_mvx_client.js";

describe("BlockRunMvxClient clawChatCompletion (TDD)", () => {
  it("should autonomously pay 402 challenge and stream chat chunks using text fallback", async () => {
    let callCount = 0;
    const challengeBody = {
      x402Version: 2,
      accepts: [
        {
          scheme: "exact",
          network: "multiversx:1",
          amount: "1850",
          asset: "USDC-c76f1f",
          payTo: "erd1ka0yrspygvjtktyzxu58ufn0kujkqgx4gq2ch5ev2aqjcem9jcqqkntrmv",
          extra: { shard: 0, arbitrageTier: "auto:reasoning", projectedProvider: "groq-fast" },
        },
      ],
      error: "Payment Required",
      price: { amount: "0.001850", currency: "USD" },
    };
    const challengeBase64 = Buffer.from(JSON.stringify(challengeBody)).toString("base64");

    const sseResponseText =
      'data: {"choices":[{"delta":{"content":"Thinking"}}]}\n\ndata: {"choices":[{"delta":{"content":"..."}}]}\n\ndata: [DONE]\n\n';

    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          status: 402,
          ok: false,
          headers: {
            get: (h: string) => (h.toLowerCase() === "payment-required" ? challengeBase64 : null),
          },
          json: async () => challengeBody,
        };
      } else {
        return {
          status: 200,
          ok: true,
          headers: {
            get: (h: string) => {
              if (h.toLowerCase() === "x-payment-receipt") return "tx-claw-receipt-999";
              if (h.toLowerCase() === "x-claw-provider-selected") return "groq-fast";
              return null;
            },
          },
          text: async () => sseResponseText,
        };
      }
    });

    const client = new BlockRunMvxClient({
      gatewayUrl: "http://localhost:4000",
      relayerAddress: "erd1ka0yrspygvjtktyzxu58ufn0kujkqgx4gq2ch5ev2aqjcem9jcqqkntrmv",
      fetch: mockFetch,
    });

    const streamResult = await client.clawChatCompletion({
      model: "auto:reasoning",
      messages: [{ role: "user", content: "Analyze market" }],
    });

    expect(streamResult.paymentReceipt).toBe("tx-claw-receipt-999");
    expect(streamResult.providerSelected).toBe("groq-fast");

    const deltas: string[] = [];
    for await (const delta of streamResult.stream) {
      deltas.push(delta);
    }

    expect(deltas).toEqual(["Thinking", "..."]);
    expect(callCount).toBe(2);
  });

  it("should incrementally stream chunks in real-time via ReadableStream reader", async () => {
    const chunks = [
      new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Streamed"}}]}\n\n'),
      new TextEncoder().encode('data: {"choices":[{"delta":{"content":" Realtime"}}]}\n\n'),
      new TextEncoder().encode("data: [DONE]\n\n"),
    ];
    let chunkIndex = 0;

    const mockReader = {
      read: vi.fn().mockImplementation(async () => {
        if (chunkIndex < chunks.length) {
          return { done: false, value: chunks[chunkIndex++] };
        }
        return { done: true, value: undefined };
      }),
    };

    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: {
        get: (h: string) => (h.toLowerCase() === "x-payment-receipt" ? "tx-stream-rec" : null),
      },
      body: {
        getReader: () => mockReader,
      },
    });

    const client = new BlockRunMvxClient({
      gatewayUrl: "http://localhost:4000",
      fetch: mockFetch,
    });

    const streamResult = await client.clawChatCompletion({
      model: "auto:fast",
      messages: [{ role: "user", content: "Fast answer" }],
    });

    const deltas: string[] = [];
    for await (const delta of streamResult.stream) {
      deltas.push(delta);
    }

    expect(deltas).toEqual(["Streamed", " Realtime"]);
    expect(mockReader.read).toHaveBeenCalled();
  });
});
