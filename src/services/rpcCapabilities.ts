import { z } from "zod";
import {
  RPC_CAPABILITIES,
  RPC_CONTRACT,
  type RpcCapability,
  type RpcDiscovery,
} from "@/generated/rpcContract";
import { getRpc2Client } from "@/services/rpc2Client";

const DiscoverySchema = z.object({
  jsonrpc_version: z.literal("2.0"),
  contract: z.string(),
  methods: z.array(z.string()),
  capabilities: z.record(z.string(), z.string()),
});

let discoveryPromise: Promise<RpcDiscovery> | null = null;

export function discoverRpcCapabilities(): Promise<RpcDiscovery> {
  if (!discoveryPromise) {
    discoveryPromise = getRpc2Client()
      .call("rpc.discover", {})
      .then((payload) => {
        const discovery = DiscoverySchema.parse(payload) as RpcDiscovery;
        if (discovery.contract !== RPC_CONTRACT) {
          throw new Error(`Unsupported Komari RPC contract: ${discovery.contract}`);
        }
        return discovery;
      })
      .catch((error) => {
        discoveryPromise = null;
        throw error;
      });
  }
  return discoveryPromise;
}

export async function requireRpcCapability(capability: RpcCapability): Promise<RpcDiscovery> {
  const discovery = await discoverRpcCapabilities();
  const required = RPC_CAPABILITIES[capability];
  if (discovery.capabilities[capability] !== required) {
    throw new Error(`Komari capability ${capability}@${required} is unavailable`);
  }
  return discovery;
}

export function resetRpcCapabilityCacheForTests() {
  discoveryPromise = null;
}
