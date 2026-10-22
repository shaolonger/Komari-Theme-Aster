export const formatNetworkTime = (value: string | number) => value ? new Date(value).toLocaleString() : "尚无记录";
export const networkGuide = "https://github.com/shaolonger/Komari-Theme-Aster/blob/main/network-observatory/README.md";
export const quoteShell = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;
export const installCommand = (uuid: string, base: string) => `curl -fsSL https://github.com/shaolonger/Komari-Theme-Aster/releases/latest/download/Aster-Network-Observatory-install.sh | sudo sh -s -- --server-url ${quoteShell(base)} --node-uuid ${quoteShell(uuid)}`;
