import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const plugin = resolve(root, "network-observatory/plugin");
const manifest = JSON.parse(readFileSync(resolve(plugin, "komari-plugin.json"), "utf8"));
const files = [
  ["komari-plugin.json", resolve(plugin, "komari-plugin.json")],
  ["script.js", resolve(plugin, "script.js")],
  ["src/model.js", resolve(plugin, "src/model.js")],
  ["runner/probe.sh", resolve(root, "network-observatory/runner/probe.sh")],
  ["README.md", resolve(root, "network-observatory/README.md")],
];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const localParts = [];
const centralParts = [];
let offset = 0;
for (const [archivePath, diskPath] of files) {
  const name = Buffer.from(archivePath, "utf8");
  const content = readFileSync(diskPath);
  const compressed = zlib.deflateRawSync(content, { level: 9 });
  const crc = crc32(content);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(name.length, 26);
  localParts.push(local, name, compressed);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);
  centralParts.push(central, name);
  offset += local.length + name.length + compressed.length;
}

const centralDirectory = Buffer.concat(centralParts);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralDirectory.length, 12);
end.writeUInt32LE(offset, 16);
const outputPath = resolve(root, `Aster-Network-Observatory-v${manifest.version}.zip`);
writeFileSync(outputPath, Buffer.concat([...localParts, centralDirectory, end]));
console.log(`Wrote ${outputPath}`);
