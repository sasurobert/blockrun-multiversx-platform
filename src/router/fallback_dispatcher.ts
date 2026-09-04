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

function getCommonPrefixLength(a: string, b: string): number {
  let i = 0;
  const max = Math.min(a.length, b.length);
  while (i < max && a[i] === b[i]) {
    i++;
  }
  return i;
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
    const executor =
      this.streamExecutor ??
      (async function* (p: ProviderSpec) {
        yield `Response from ${p.name} for ${request.model}`;
      });

    for (let i = 0; i < providers.length; i++) {
      const primaryProvider = providers[i];
      const isFallback = i > 0;
      const abortController = new AbortController();

      try {
        const streamGen = executor(primaryProvider, request, abortController.signal);

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
        const remainingProviders = providers.slice(i + 1);

        // Token Streaming Buffer for seamless mid-stream fallback without duplicate tokens
        async function* wrappedBufferedStream(): AsyncIterable<string> {
          let emittedText = "";
          let currentIterator = iterator;
          let currentAbort = abortController;
          let fallbackIdx = 0;
          let fallbackAccumulated = "";
          let prefixTrimmed = true;

          if (firstValue !== undefined) {
            emittedText += firstValue;
            yield firstValue;
          }

          while (true) {
            let next: IteratorResult<string, any>;
            try {
              next = await currentIterator.next();
            } catch (streamErr: unknown) {
              // Provider failed or stalled mid-stream!
              currentAbort.abort();

              if (fallbackIdx >= remainingProviders.length) {
                // No more fallback providers available
                throw streamErr;
              }

              // Engage next fallback provider in cascading chain
              const fallbackProvider = remainingProviders[fallbackIdx++];
              const fallbackAbort = new AbortController();
              currentAbort = fallbackAbort;

              const fallbackGen = executor(fallbackProvider, request, fallbackAbort.signal);
              currentIterator = fallbackGen[Symbol.asyncIterator]();
              fallbackAccumulated = "";
              prefixTrimmed = false;
              continue;
            }

            if (next.done) {
              // If stream ended but prefix wasn't trimmed yet, flush divergent tail
              if (!prefixTrimmed && fallbackAccumulated.length > 0) {
                const overlapLen = getCommonPrefixLength(emittedText, fallbackAccumulated);
                const delta = fallbackAccumulated.slice(overlapLen);
                prefixTrimmed = true;
                if (delta.length > 0) {
                  emittedText += delta;
                  yield delta;
                }
              }
              break;
            }

            if (!prefixTrimmed) {
              fallbackAccumulated += next.value;
              if (fallbackAccumulated.length > emittedText.length) {
                if (fallbackAccumulated.startsWith(emittedText)) {
                  const newDelta = fallbackAccumulated.slice(emittedText.length);
                  prefixTrimmed = true;
                  emittedText = fallbackAccumulated;
                  if (newDelta.length > 0) {
                    yield newDelta;
                  }
                } else {
                  const overlapLen = getCommonPrefixLength(emittedText, fallbackAccumulated);
                  const delta = fallbackAccumulated.slice(overlapLen);
                  prefixTrimmed = true;
                  emittedText += delta;
                  if (delta.length > 0) {
                    yield delta;
                  }
                }
              }
            } else {
              emittedText += next.value;
              yield next.value;
            }
          }
        }

        return {
          providerId: primaryProvider.id,
          fallbackOccurred: isFallback,
          ttftMs,
          stream: wrappedBufferedStream(),
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
