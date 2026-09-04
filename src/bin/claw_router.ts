import dotenv from "dotenv";
dotenv.config();
import http from "http";
import { ClawRouterServer } from "../router/router_server.js";
import { VerifierService } from "../services/verifier.js";
import { MvxApiNetworkProvider } from "../domain/network.js";
import { MerchantPoolManager } from "../services/merchant_pool.js";

async function main() {
  const port = parseInt(process.env.ROUTER_PORT || "4000", 10);
  const apiUrl = process.env.MULTIVERSX_API_URL || "https://api.multiversx.com";
  const network = process.env.MULTIVERSX_NETWORK || "multiversx:1";

  const networkProvider = new MvxApiNetworkProvider(apiUrl, {
    clientName: "multiversx-claw-router",
  });

  const verifier = new VerifierService({
    networkProvider,
  });

  const merchantPool = new MerchantPoolManager();

  const routerServer = new ClawRouterServer({
    verifier,
    merchantPool,
    network,
  });

  const server = http.createServer(routerServer.app);

  server.listen(port, () => {
    console.log(`ClawRouter started on http://localhost:${port}`);
  });
}

if (process.argv[1]?.includes("claw_router")) {
  main().catch((err) => {
    console.error("ClawRouter startup error:", err);
    process.exit(1);
  });
}
