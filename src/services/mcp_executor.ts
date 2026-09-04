import { McpToolCallResult } from "../domain/mcp_types.js";

export type McpToolHandler = (
  args: Record<string, unknown>
) => Promise<McpToolCallResult>;

export interface McpExecutorOptions {
  timeoutMs?: number;
}

export class McpExecutor {
  private handlers = new Map<string, McpToolHandler>();
  private timeoutMs: number;

  constructor(options: McpExecutorOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  public registerHandler(toolName: string, handler: McpToolHandler): void {
    this.handlers.set(toolName, handler);
  }

  public async executeTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<McpToolCallResult> {
    const handler = this.handlers.get(toolName);
    if (!handler) {
      return {
        content: [
          {
            type: "text",
            text: `Tool '${toolName}' not found on upstream executor.`,
          },
        ],
        isError: true,
      };
    }

    try {
      const timeoutPromise = new Promise<McpToolCallResult>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Tool execution timed out after ${this.timeoutMs}ms`)),
          this.timeoutMs
        )
      );

      return await Promise.race([handler(args), timeoutPromise]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text",
            text: `Execution error: ${message}`,
          },
        ],
        isError: true,
      };
    }
  }
}
