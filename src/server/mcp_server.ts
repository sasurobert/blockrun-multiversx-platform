import http from "http";
import { McpGateway, McpGatewayOptions } from "../gateway/mcp_gateway.js";
import { McpRegistryAdapter } from "../services/mcp_registry_adapter.js";
import { McpExecutor } from "../services/mcp_executor.js";
import { MerchantPoolManager } from "../services/merchant_pool.js";
import { VerifierService } from "../services/verifier.js";

export interface McpServerConfig {
  port?: number;
  network?: string;
  gatewayOptions?: Partial<McpGatewayOptions>;
}

export function createMcpServer(config: McpServerConfig = {}) {
  const port = config.port ?? 3500;
  const registry = config.gatewayOptions?.registry ?? new McpRegistryAdapter();
  const executor = config.gatewayOptions?.executor ?? new McpExecutor();
  const merchantPool = config.gatewayOptions?.merchantPool ?? new MerchantPoolManager();
  const verifier = config.gatewayOptions?.verifier;

  if (!verifier) {
    throw new Error("VerifierService must be provided to createMcpServer");
  }

  const gateway = new McpGateway({
    registry,
    executor,
    merchantPool,
    verifier,
    reputationClient: config.gatewayOptions?.reputationClient,
    proofLogger: config.gatewayOptions?.proofLogger,
    settlementQueue: config.gatewayOptions?.settlementQueue,
    network: config.network ?? "multiversx:1",
  });

  const server = http.createServer(gateway.app);

  return {
    app: gateway.app,
    gateway,
    server,
    listen: (listenPort = port) => {
      return new Promise<void>((resolve) => {
        server.listen(listenPort, () => {
          resolve();
        });
      });
    },
    close: () => {
      return new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
