import { ProviderSpec, ClawChatRequest, FallbackDispatchResult } from "./types.js";

export type StreamExecutorFn = (
  provider: ProviderSpec,
  request: ClawChatRequest,
  signal: AbortSignal
) => AsyncIterable<string>;

export interface CascadingFallbackDispatcherOptions {
  fallbackTimeoutMs?: number;
  streamExecutor?: StreamExecutorFn;
}

export class CascadingFallbackDispatcher {
  private fallbackTimeoutMs: number;
  private streamExecutor?: StreamExecutorFn;

  constructor(options: CascadingFallbackDispatcherOptions = {}) {
    this.fallbackTimeoutMs = options.fallbackTimeoutMs ?? 400;
    this.streamExecutor = options.streamExecutor;
  }

  public async dispatch(
    providers: ProviderSpec[],
    request: ClawChatRequest
  ): Promise<FallbackDispatchResult> {
    if (providers.length === 0) {
      throw new Error("No available providers in routing matrix");
    }

    let lastError: Error | null = null;

    for (let i = 0; i < providers.length; i++) {
      const provider = providers[i];
      const isFallback = i > 0;
      const abortController = new AbortController();

      try {
        const executor =
          this.streamExecutor ??
          (async function* (p: ProviderSpec) {
            yield `Response from ${p.name} for ${request.model}`;
          });

        const streamGen = executor(provider, request, abortController.signal);

        // Probe TTFT with timeout
        const start = Date.now();
        const iterator = streamGen[Symbol.asyncIterator]();

        const firstChunkPromise = iterator.next();
        const timeoutPromise = new Promise<{ done: boolean; value: undefined }>((_, reject) =>
          setTimeout(
            () => reject(new Error(`TTFT timeout after ${this.fallbackTimeoutMs}ms`)),
            this.fallbackTimeoutMs
          )
        );

        const firstResult = await Promise.race([firstChunkPromise, timeoutPromise]);
        const ttftMs = Date.now() - start;

        if (firstResult.done) {
          continue; // empty response, try next
        }

        const firstValue = firstResult.value;

        // Wrap generator to include the first already-fetched chunk
        async function* wrappedStream() {
          if (firstValue !== undefined) {
            yield firstValue;
          }
          while (true) {
            const next = await iterator.next();
            if (next.done) break;
            yield next.value;
          }
        }

        return {
          providerId: provider.id,
          fallbackOccurred: isFallback,
          ttftMs,
          stream: wrappedStream(),
        };
      } catch (err: unknown) {
        abortController.abort();
        lastError = err instanceof Error ? err : new Error(String(err));
        // Continue to fallback provider
      }
    }

    throw lastError ?? new Error("All providers in fallback chain failed");
  }
}
