const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function isHost(value) {
  if (typeof value !== "string") return false;
  const host = value.trim();
  if (!host || host.length > 253 || /[\s/\\@?#]/.test(host)) return false;
  if (/^[0-9.]+$/.test(host)) {
    const octets = host.split(".");
    return octets.length === 4 && octets.every((octet) => /^(0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255);
  }
  if (host.includes(":")) {
    if (!/^[0-9a-f:]+$/i.test(host) || host.includes(":::")) return false;
    if ((host.match(/::/g) || []).length > 1) return false;
    const compressed = host.includes("::");
    const parts = host.split(":").filter(Boolean);
    return parts.every((part) => /^[0-9a-f]{1,4}$/i.test(part)) &&
      (compressed ? parts.length < 8 : parts.length === 8);
  }
  return HOST.test(host);
}

function readAdminPrincipal(principal) {
  if (!principal || !["user", "api_key"].includes(principal.type)) return false;
  const roles = Array.isArray(principal.roles) ? principal.roles.map((role) => String(role).toLowerCase()) : [];
  return roles.some((role) => role === "admin" || role === "administrator");
}

module.exports = { UUID, isHost, readAdminPrincipal };
