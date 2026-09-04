import { McpToolDefinition, ToolHealthStatus } from "../domain/mcp_types.js";

export interface AgentServicePricing {
  token: string;
  amount: string;
  nonce: number;
}

export type QueryServiceConfigFn = (
  agentNonce: number,
  serviceId: number
) => Promise<AgentServicePricing | null>;

export interface McpRegistryAdapterOptions {
  identityContractAddress?: string;
  queryServiceConfigFn?: QueryServiceConfigFn;
  cacheTtlMs?: number;
}

interface CacheEntry {
  pricing: AgentServicePricing | null;
  expiresAt: number;
}

export class McpRegistryAdapter {
  private identityContractAddress?: string;
  private queryServiceConfigFn?: QueryServiceConfigFn;
  private cacheTtlMs: number;
  private cache = new Map<string, CacheEntry>();
  private localTools = new Map<string, McpToolDefinition>();
  private toolHealth = new Map<string, ToolHealthStatus>();

  constructor(options: McpRegistryAdapterOptions = {}) {
    this.identityContractAddress = options.identityContractAddress;
    this.queryServiceConfigFn = options.queryServiceConfigFn;
    this.cacheTtlMs = options.cacheTtlMs ?? 30_000;
  }

  public async getServiceConfig(
    agentNonce: number,
    serviceId: number
  ): Promise<AgentServicePricing | null> {
    const cacheKey = `${agentNonce}:${serviceId}`;
    const now = Date.now();
    const cached = this.cache.get(cacheKey);

    if (cached && cached.expiresAt > now) {
      return cached.pricing;
    }

    if (!this.queryServiceConfigFn) {
      return null;
    }

    const result = await this.queryServiceConfigFn(agentNonce, serviceId);
    this.cache.set(cacheKey, {
      pricing: result,
      expiresAt: now + this.cacheTtlMs,
    });

    return result;
  }

  public registerLocalTool(tool: McpToolDefinition): void {
    this.localTools.set(tool.name, tool);
    if (!this.toolHealth.has(tool.name)) {
      this.toolHealth.set(tool.name, {
        name: tool.name,
        status: "healthy",
        latencyMs: 15,
        lastHeartbeat: Date.now(),
        callCount: 0,
        errorCount: 0,
        uptimePct: 100.0,
      });
    }
  }

  public getLocalTool(name: string): McpToolDefinition | undefined {
    return this.localTools.get(name);
  }

  public listLocalTools(): McpToolDefinition[] {
    return Array.from(this.localTools.values());
  }

  public recordToolHeartbeat(
    name: string,
    latencyMs: number = 20,
    status: "healthy" | "degraded" | "unreachable" = "healthy"
  ): ToolHealthStatus {
    let health = this.toolHealth.get(name);
    if (!health) {
      health = {
        name,
        status,
        latencyMs,
        lastHeartbeat: Date.now(),
        callCount: 0,
        errorCount: 0,
        uptimePct: 100.0,
      };
      this.toolHealth.set(name, health);
    } else {
      health.lastHeartbeat = Date.now();
      health.latencyMs = latencyMs;
      health.status = status;
    }
    return health;
  }

  public recordToolExecution(name: string, success: boolean, durationMs: number): void {
    let health = this.toolHealth.get(name);
    if (!health) {
      health = this.recordToolHeartbeat(name, durationMs);
    }
    health.callCount++;
    if (!success) {
      health.errorCount++;
    }
    health.latencyMs = Math.round(health.latencyMs * 0.7 + durationMs * 0.3);
    const errorRate = health.errorCount / Math.max(1, health.callCount);
    health.uptimePct = Math.max(0, Math.round((1 - errorRate) * 1000) / 10);
    if (errorRate > 0.5) {
      health.status = "unreachable";
    } else if (errorRate > 0.1 || health.latencyMs > 2000) {
      health.status = "degraded";
    } else {
      health.status = "healthy";
    }
  }

  public getToolHealth(name: string): ToolHealthStatus | undefined {
    return this.toolHealth.get(name);
  }

  public getAllToolHealth(): ToolHealthStatus[] {
    return Array.from(this.toolHealth.values());
  }

  public clearCache(): void {
    this.cache.clear();
  }
}
