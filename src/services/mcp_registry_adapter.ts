import fs from "fs";
import path from "path";
import Database, { Database as DatabaseType } from "better-sqlite3";
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
  dbPathOrDb?: string | DatabaseType;
}

interface CacheEntry {
  pricing: AgentServicePricing | null;
  expiresAt: number;
}

interface RegisteredToolRow {
  name: string;
  description: string;
  input_schema: string;
  pricing_json: string;
  pay_to: string | null;
  endpoint_url: string | null;
  reputation_score: number | null;
  total_completed_jobs: number | null;
  created_at: number;
  updated_at: number;
}

interface ToolHealthRow {
  name: string;
  status: string;
  latency_ms: number;
  last_heartbeat: number;
  call_count: number;
  error_count: number;
  uptime_pct: number;
  updated_at: number;
}

export class McpRegistryAdapter {
  private identityContractAddress?: string;
  private queryServiceConfigFn?: QueryServiceConfigFn;
  private cacheTtlMs: number;
  private cache = new Map<string, CacheEntry>();
  private readonly db: DatabaseType;
  private readonly ownsDb: boolean = false;

  constructor(options: McpRegistryAdapterOptions = {}) {
    this.identityContractAddress = options.identityContractAddress;
    this.queryServiceConfigFn = options.queryServiceConfigFn;
    this.cacheTtlMs = options.cacheTtlMs ?? 30_000;

    const dbPathOrDb =
      options.dbPathOrDb ?? process.env.SQLITE_DB_PATH ?? ":memory:";

    if (typeof dbPathOrDb === "string") {
      if (dbPathOrDb !== ":memory:") {
        const dir = path.dirname(dbPathOrDb);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      }
      this.db = new Database(dbPathOrDb);
      this.ownsDb = true;
    } else {
      this.db = dbPathOrDb;
      this.ownsDb = false;
    }

    this.initDatabase();
  }

  private initDatabase(): void {
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS registered_tools (
        name TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        input_schema TEXT NOT NULL,
        pricing_json TEXT NOT NULL,
        pay_to TEXT,
        endpoint_url TEXT,
        reputation_score REAL,
        total_completed_jobs INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tool_health (
        name TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        latency_ms REAL NOT NULL,
        last_heartbeat INTEGER NOT NULL,
        call_count INTEGER NOT NULL,
        error_count INTEGER NOT NULL,
        uptime_pct REAL NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tool_health_status ON tool_health(status);
    `);
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

  private mapRowToTool(row: RegisteredToolRow): McpToolDefinition {
    return {
      name: row.name,
      description: row.description,
      inputSchema: JSON.parse(row.input_schema),
      pricing: JSON.parse(row.pricing_json),
      payTo: row.pay_to ?? undefined,
      endpointUrl: row.endpoint_url ?? undefined,
      reputationScore: row.reputation_score !== null ? row.reputation_score : undefined,
      totalCompletedJobs: row.total_completed_jobs !== null ? row.total_completed_jobs : undefined,
    };
  }

  private mapRowToHealth(row: ToolHealthRow): ToolHealthStatus {
    return {
      name: row.name,
      status: row.status as "healthy" | "degraded" | "unreachable",
      latencyMs: row.latency_ms,
      lastHeartbeat: row.last_heartbeat,
      callCount: row.call_count,
      errorCount: row.error_count,
      uptimePct: row.uptime_pct,
    };
  }

  public registerLocalTool(tool: McpToolDefinition): void {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO registered_tools (
        name, description, input_schema, pricing_json,
        pay_to, endpoint_url, reputation_score, total_completed_jobs,
        created_at, updated_at
      ) VALUES (
        @name, @description, @input_schema, @pricing_json,
        @pay_to, @endpoint_url, @reputation_score, @total_completed_jobs,
        @created_at, @updated_at
      )
      ON CONFLICT(name) DO UPDATE SET
        description = excluded.description,
        input_schema = excluded.input_schema,
        pricing_json = excluded.pricing_json,
        pay_to = excluded.pay_to,
        endpoint_url = excluded.endpoint_url,
        reputation_score = excluded.reputation_score,
        total_completed_jobs = excluded.total_completed_jobs,
        updated_at = excluded.updated_at
    `);

    stmt.run({
      name: tool.name,
      description: tool.description,
      input_schema: JSON.stringify(tool.inputSchema),
      pricing_json: JSON.stringify(tool.pricing),
      pay_to: tool.payTo ?? null,
      endpoint_url: tool.endpointUrl ?? null,
      reputation_score: tool.reputationScore ?? null,
      total_completed_jobs: tool.totalCompletedJobs ?? null,
      created_at: now,
      updated_at: now,
    });

    // Ensure health record exists
    const healthStmt = this.db.prepare<[string], ToolHealthRow>(
      "SELECT * FROM tool_health WHERE name = ?"
    );
    const existingHealth = healthStmt.get(tool.name);
    if (!existingHealth) {
      const insertHealth = this.db.prepare(`
        INSERT INTO tool_health (
          name, status, latency_ms, last_heartbeat, call_count, error_count, uptime_pct, updated_at
        ) VALUES (
          @name, 'healthy', 15, @last_heartbeat, 0, 0, 100.0, @updated_at
        )
      `);
      insertHealth.run({
        name: tool.name,
        last_heartbeat: now,
        updated_at: now,
      });
    }
  }

  public getLocalTool(name: string): McpToolDefinition | undefined {
    const stmt = this.db.prepare<[string], RegisteredToolRow>(
      "SELECT * FROM registered_tools WHERE name = ?"
    );
    const row = stmt.get(name);
    if (!row) {
      return undefined;
    }
    return this.mapRowToTool(row);
  }

  public listLocalTools(): McpToolDefinition[] {
    const stmt = this.db.prepare<[], RegisteredToolRow>(
      "SELECT * FROM registered_tools ORDER BY name ASC"
    );
    const rows = stmt.all();
    return rows.map((r) => this.mapRowToTool(r));
  }

  public recordToolHeartbeat(
    name: string,
    latencyMs: number = 20,
    status: "healthy" | "degraded" | "unreachable" = "healthy"
  ): ToolHealthStatus {
    const now = Date.now();
    const existing = this.getToolHealth(name);
    if (!existing) {
      const stmt = this.db.prepare(`
        INSERT INTO tool_health (
          name, status, latency_ms, last_heartbeat, call_count, error_count, uptime_pct, updated_at
        ) VALUES (
          @name, @status, @latency_ms, @last_heartbeat, 0, 0, 100.0, @updated_at
        )
      `);
      stmt.run({
        name,
        status,
        latency_ms: latencyMs,
        last_heartbeat: now,
        updated_at: now,
      });
      return {
        name,
        status,
        latencyMs,
        lastHeartbeat: now,
        callCount: 0,
        errorCount: 0,
        uptimePct: 100.0,
      };
    } else {
      const stmt = this.db.prepare(`
        UPDATE tool_health SET
          status = @status,
          latency_ms = @latency_ms,
          last_heartbeat = @last_heartbeat,
          updated_at = @updated_at
        WHERE name = @name
      `);
      stmt.run({
        name,
        status,
        latency_ms: latencyMs,
        last_heartbeat: now,
        updated_at: now,
      });
      return {
        ...existing,
        status,
        latencyMs,
        lastHeartbeat: now,
      };
    }
  }

  public recordToolExecution(name: string, success: boolean, durationMs: number): void {
    let health = this.getToolHealth(name);
    if (!health) {
      health = this.recordToolHeartbeat(name, durationMs);
    }
    const callCount = health.callCount + 1;
    const errorCount = health.errorCount + (success ? 0 : 1);
    const latencyMs = Math.round(health.latencyMs * 0.7 + durationMs * 0.3);
    const errorRate = errorCount / Math.max(1, callCount);
    const uptimePct = Math.max(0, Math.round((1 - errorRate) * 1000) / 10);
    let status: "healthy" | "degraded" | "unreachable";
    if (errorRate > 0.5) {
      status = "unreachable";
    } else if (errorRate > 0.1 || latencyMs > 2000) {
      status = "degraded";
    } else {
      status = "healthy";
    }

    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE tool_health SET
        call_count = @call_count,
        error_count = @error_count,
        latency_ms = @latency_ms,
        uptime_pct = @uptime_pct,
        status = @status,
        updated_at = @updated_at
      WHERE name = @name
    `);
    stmt.run({
      name,
      call_count: callCount,
      error_count: errorCount,
      latency_ms: latencyMs,
      uptime_pct: uptimePct,
      status,
      updated_at: now,
    });
  }

  public getToolHealth(name: string): ToolHealthStatus | undefined {
    const stmt = this.db.prepare<[string], ToolHealthRow>(
      "SELECT * FROM tool_health WHERE name = ?"
    );
    const row = stmt.get(name);
    if (!row) {
      return undefined;
    }
    return this.mapRowToHealth(row);
  }

  public getAllToolHealth(): ToolHealthStatus[] {
    const stmt = this.db.prepare<[], ToolHealthRow>(
      "SELECT * FROM tool_health ORDER BY name ASC"
    );
    const rows = stmt.all();
    return rows.map((r) => this.mapRowToHealth(r));
  }

  public clearCache(): void {
    this.cache.clear();
  }

  public clearTools(): void {
    this.db.exec("DELETE FROM registered_tools; DELETE FROM tool_health;");
  }

  public close(): void {
    if (this.ownsDb && this.db.open) {
      this.db.close();
    }
  }
}
