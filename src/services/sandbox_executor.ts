import vm from "node:vm";

export interface SandboxExecutionOptions {
  timeoutMs?: number;
  maxOutputLength?: number;
  maxMemoryBytes?: number;
}

export interface SandboxExecutionResult {
  result: unknown;
  isError: boolean;
  error?: string;
  executionTimeMs: number;
}

/**
 * Isolated Node.js vm-based sandbox executor for mathematical calculations,
 * algorithmic evaluations, and untrusted agent-submitted code.
 */
export class SandboxExecutor {
  private defaultTimeoutMs: number;
  private maxOutputLength: number;
  private maxMemoryBytes?: number;

  constructor(options?: SandboxExecutionOptions) {
    this.defaultTimeoutMs = options?.timeoutMs ?? 1000;
    this.maxOutputLength = options?.maxOutputLength ?? 8192;
    this.maxMemoryBytes = options?.maxMemoryBytes ?? 32 * 1024 * 1024; // 32MB default
  }

  /**
   * Compiles code into a vm.Script safely:
   * First attempts to compile directly as a script (handling multi-statement expressions, functions, etc.).
   * If and only if it fails with an "Illegal return statement" SyntaxError (top-level return),
   * it compiles wrapped in an arrow IIFE.
   */
  private compileScript(code: string): vm.Script {
    let trimmed = code.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      trimmed = `(${trimmed})`;
    }
    try {
      return new vm.Script(trimmed, { filename: "sandbox.js" });
    } catch (err: unknown) {
      if (err instanceof SyntaxError && err.message.includes("Illegal return statement")) {
        return new vm.Script(`(() => {\n${trimmed}\n})()`, { filename: "sandbox.js" });
      }
      throw err;
    }
  }

  /**
   * Executes code within an isolated Node.js vm context with stripped globals and strict timeouts.
   */
  public execute(
    code: string,
    options?: { timeoutMs?: number; maxMemoryBytes?: number }
  ): SandboxExecutionResult {
    const startTime = Date.now();
    const timeout = options?.timeoutMs ?? this.defaultTimeoutMs;

    // Reject dangerous keywords upfront
    const forbiddenPatterns = [
      /\bprocess\b/,
      /\brequire\b/,
      /\bimport\b/,
      /\bchild_process\b/,
      /\bfs\b/,
      /\bglobalThis\b/,
      /\bglobal\b/,
      /\bFunction\b/,
      /\beval\b/,
      /\b__proto__\b/,
      /\bconstructor\b/,
      /\bprototype\b/,
      /\bWebAssembly\b/,
      /\bReflect\b/,
    ];

    for (const pattern of forbiddenPatterns) {
      if (pattern.test(code)) {
        return {
          result: null,
          isError: true,
          error: `Security Violation: forbidden symbol detected (${pattern.source})`,
          executionTimeMs: Date.now() - startTime,
        };
      }
    }

    const startMemory = process.memoryUsage().heapUsed;

    // Build isolated sandbox context without polluting host or leaking host prototypes.
    // vm.createContext instantiates standard globals (Math, Number, String, Array, Date, JSON, etc.)
    // native to the guest realm.
    const sandboxContext = Object.create(null);
    sandboxContext.console = Object.freeze({
      log: () => {},
      warn: () => {},
      error: () => {},
    });

    const context = vm.createContext(sandboxContext);

    // Defense-in-depth: delete constructor accessors inside the isolated guest context realm
    try {
      vm.runInContext(
        `
        try { delete Object.prototype.constructor; } catch (_) {}
        try { delete Function.prototype.constructor; } catch (_) {}
        try { delete Array.prototype.constructor; } catch (_) {}
        try { delete Promise.prototype.constructor; } catch (_) {}
        `,
        context
      );
    } catch {
      // Ignore if cannot delete
    }

    try {
      const script = this.compileScript(code);

      const rawResult = script.runInContext(context, {
        timeout,
        microtaskMode: "afterEvaluate",
      } as vm.RunningScriptOptions);

      // Memory check
      const currentMemory = process.memoryUsage().heapUsed;
      const memLimit = options?.maxMemoryBytes ?? this.maxMemoryBytes;
      if (memLimit && currentMemory - startMemory > memLimit) {
        return {
          result: null,
          isError: true,
          error: `Memory limit exceeded (${Math.round((currentMemory - startMemory) / (1024 * 1024))}MB > ${Math.round(memLimit / (1024 * 1024))}MB)`,
          executionTimeMs: Date.now() - startTime,
        };
      }

      let sanitizedResult = rawResult;
      if (typeof rawResult === "function") {
        sanitizedResult = "[Function]";
      } else if (rawResult !== undefined && rawResult !== null && typeof rawResult === "object") {
        const serialized = JSON.stringify(rawResult);
        if (serialized.length > this.maxOutputLength) {
          return {
            result: null,
            isError: true,
            error: `Output exceeded maximum allowed length (${serialized.length} > ${this.maxOutputLength})`,
            executionTimeMs: Date.now() - startTime,
          };
        }
        sanitizedResult = JSON.parse(serialized);
      } else if (typeof rawResult === "string" && rawResult.length > this.maxOutputLength) {
        sanitizedResult = rawResult.slice(0, this.maxOutputLength) + "... [truncated]";
      }

      const executionTimeMs = Date.now() - startTime;
      return {
        result: sanitizedResult,
        isError: false,
        executionTimeMs,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        result: null,
        isError: true,
        error: `Sandbox execution failed: ${message}`,
        executionTimeMs: Date.now() - startTime,
      };
    }
  }
}
