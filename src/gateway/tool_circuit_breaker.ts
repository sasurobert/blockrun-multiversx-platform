export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface ToolCircuitBreakerOptions {
  failureThreshold?: number;
  cooldownMs?: number;
  timeoutMs?: number;
}

export interface ToolCircuitState {
  state: CircuitState;
  consecutiveFailures: number;
  lastFailureTime: number;
  nextAttemptTime: number;
}

export class ToolCircuitOpenError extends Error {
  public readonly code = "TOOL_CIRCUIT_OPEN";
  constructor(public readonly toolName: string) {
    super(`Tool circuit breaker is OPEN for '${toolName}'. Upstream service degraded.`);
    this.name = "ToolCircuitOpenError";
  }
}

export class ToolUpstreamTimeoutError extends Error {
  public readonly code = "TOOL_UPSTREAM_TIMEOUT";
  constructor(public readonly toolName: string, public readonly timeoutMs: number) {
    super(`Upstream tool '${toolName}' request timed out after ${timeoutMs}ms`);
    this.name = "ToolUpstreamTimeoutError";
  }
}

/**
 * Resilient per-tool circuit breaker tracking consecutive failures,
 * timeouts, and state transitions (CLOSED -> OPEN -> HALF_OPEN -> CLOSED).
 */
export class ToolCircuitBreaker {
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly timeoutMs: number;
  private readonly tools = new Map<string, ToolCircuitState>();

  constructor(options: ToolCircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 3;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  public getTimeoutMs(): number {
    return this.timeoutMs;
  }

  public getFailureThreshold(): number {
    return this.failureThreshold;
  }

  public getCooldownMs(): number {
    return this.cooldownMs;
  }

  private getOrCreate(toolName: string): ToolCircuitState {
    let entry = this.tools.get(toolName);
    if (!entry) {
      entry = {
        state: "CLOSED",
        consecutiveFailures: 0,
        lastFailureTime: 0,
        nextAttemptTime: 0,
      };
      this.tools.set(toolName, entry);
    }
    return entry;
  }

  public getState(toolName: string): CircuitState {
    const entry = this.getOrCreate(toolName);
    if (entry.state === "OPEN") {
      const now = Date.now();
      if (now >= entry.nextAttemptTime) {
        entry.state = "HALF_OPEN";
        return "HALF_OPEN";
      }
    }
    return entry.state;
  }

  public canExecute(toolName: string): boolean {
    const state = this.getState(toolName);
    return state === "CLOSED" || state === "HALF_OPEN";
  }

  public recordSuccess(toolName: string): void {
    const entry = this.getOrCreate(toolName);
    entry.state = "CLOSED";
    entry.consecutiveFailures = 0;
    entry.lastFailureTime = 0;
    entry.nextAttemptTime = 0;
  }

  public recordFailure(toolName: string): void {
    const entry = this.getOrCreate(toolName);
    entry.consecutiveFailures += 1;
    entry.lastFailureTime = Date.now();

    if (entry.state === "HALF_OPEN" || entry.consecutiveFailures >= this.failureThreshold) {
      entry.state = "OPEN";
      entry.nextAttemptTime = entry.lastFailureTime + this.cooldownMs;
    }
  }

  public reset(toolName?: string): void {
    if (toolName) {
      this.tools.delete(toolName);
    } else {
      this.tools.clear();
    }
  }

  /**
   * Wraps an external upstream tool HTTP call with timeout signal and circuit breaker protection.
   */
  public async execute<T>(
    toolName: string,
    action: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    if (!this.canExecute(toolName)) {
      throw new ToolCircuitOpenError(toolName);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort(new ToolUpstreamTimeoutError(toolName, this.timeoutMs));
    }, this.timeoutMs);

    try {
      const result = await action(controller.signal);
      clearTimeout(timeoutId);
      this.recordSuccess(toolName);
      return result;
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      this.recordFailure(toolName);

      // Distinguish AbortSignal timeout
      if (
        (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) ||
        controller.signal.aborted
      ) {
        throw new ToolUpstreamTimeoutError(toolName, this.timeoutMs);
      }
      throw err;
    }
  }
}
