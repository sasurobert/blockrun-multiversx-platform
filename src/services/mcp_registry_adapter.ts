import { McpToolDefinition } from "../domain/mcp_types.js";

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
  }

  public getLocalTool(name: string): McpToolDefinition | undefined {
    return this.localTools.get(name);
  }

  public listLocalTools(): McpToolDefinition[] {
    return Array.from(this.localTools.values());
  }

  public clearCache(): void {
    this.cache.clear();
  }
}
