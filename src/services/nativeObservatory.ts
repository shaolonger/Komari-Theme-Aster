import { z } from "zod";
const worker = z.object({
  seenAt: z.number(),
  version: z.string(),
  tools: z.array(z.string()),
  authScheme: z.string(),
  features: z.array(z.string()).default([]),
});
const catalog = z.object({
  runnerRelease: z.object({ version: z.string(), protocol: z.number(), releaseTag: z.string(), archive: z.string() }).optional(),
  updatePolicies: z.record(z.object({ enabled: z.boolean() })).default({}),
  updates: z.record(z.object({ state: z.string(), message: z.string(), at: z.string() })).default({}),
  revision: z.number(),
  workers: z.record(worker),
  inventory: z.array(
    z.object({ uuid: z.string(), name: z.string(), group: z.string() }),
  ),
  inventoryError: z.string().optional(),
  probes: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      city: z.string(),
      carrier: z.string(),
      accessType: z.string(),
      publicAddress: z.string().optional(),
      online: z.boolean(),
    }),
  ),
  endpoints: z.record(
    z.object({
      address: z.string(),
      ipv4: z.string().default(""),
      ipv6: z.string().default(""),
      port: z.number(),
    }),
  ),
  registeredNodes: z.array(z.string()).default([]),
});
async function request(
  route: string,
  method = "GET",
  body?: unknown,
): Promise<unknown> {
  const res = await fetch("/api/aster-network-observatory/v2" + route, {
    method,
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
export const nativeCatalog = async () =>
  catalog.parse(await request("/catalog"));
export const nativeEndpoint = (
  nodeUuid: string,
  address: string,
  ipv4: string,
  ipv6: string,
  port: number,
) => request("/endpoints", "POST", { nodeUuid, address, ipv4, ipv6, port });
export const registerProbe = async (body: unknown) =>
  z
    .object({ id: z.string(), token: z.string() })
    .parse(await request("/probes", "POST", body));
export const revokeProbe = (id: string) =>
  request(`/probes/${encodeURIComponent(id)}`, "DELETE");
export const issueNodeToken = async (uuid: string) =>
  z
    .object({ uuid: z.string(), token: z.string() })
    .parse(
      await request(`/nodes/${encodeURIComponent(uuid)}/token`, "POST", {}),
    );
export const revokeNodeToken = (uuid: string) =>
  request(`/nodes/${encodeURIComponent(uuid)}/token`, "DELETE");
export const setWorkerUpdatePolicy = (role: "node" | "probe", id: string, enabled: boolean) =>
  request(`/workers/${role}/${encodeURIComponent(id)}/update-policy`, "PUT", { enabled });
