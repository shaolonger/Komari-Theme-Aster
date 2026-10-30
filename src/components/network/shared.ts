export const formatNetworkTime = (value: string | number) => value ? new Date(value).toLocaleString() : "尚无记录";
export const networkGuide = "https://github.com/shaolonger/Komari-Theme-Aster/blob/main/network-observatory/README.md";
export const quoteShell = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;
export const installCommand = (uuid: string, base: string, options: { upgrade?: boolean; profile?: string; role?: "node" | "probe" } = {}) => `curl -fsSL https://github.com/shaolonger/Komari-Theme-Aster/releases/latest/download/Aster-Network-Observatory-install.sh | sudo sh -s --${options.upgrade ? " --upgrade" : ""}${options.role === "probe" ? "" : " --enable-tcpquality-full"}${options.profile ? ` --profile ${quoteShell(options.profile)}` : ""} --server-url ${quoteShell(base)} --${options.role === "probe" ? "probe-id" : "node-uuid"} ${quoteShell(uuid)}`;

// An existing worker's credential must be replaced before the transactional
// upgrade verifies it; a full-enabled fresh install deliberately rejects an
// existing configuration to protect old workers from a privileged helper.
export const resetNodeCommand = (uuid: string, base: string) =>
  `if [ -f /usr/local/libexec/aster-network-observatory/agent.py ]; then sudo python3 /usr/local/libexec/aster-network-observatory/agent.py configure --server-url ${quoteShell(base)} --node-uuid ${quoteShell(uuid)} && ${installCommand(uuid, base, { upgrade: true, profile: "preserve" })}; else ${installCommand(uuid, base)}; fi`;
