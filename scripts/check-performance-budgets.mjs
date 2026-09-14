import { brotliCompressSync, constants } from "node:zlib";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIST = new URL("../dist/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL(".vite/manifest.json", DIST), "utf8"));
const bySource = new Map(Object.entries(manifest));
const entryKey = [...bySource].find(([, item]) => item.isEntry)?.[0];
const homeKey = [...bySource].find(([key]) => key.endsWith("src/pages/Home.tsx"))?.[0];
if (!entryKey || !homeKey) throw new Error("Vite manifest is missing main or Home entries");

const assets = new Set();
const visit = (key) => {
  const item = manifest[key];
  if (!item || assets.has(item.file)) return;
  assets.add(item.file);
  for (const css of item.css ?? []) assets.add(css);
  for (const imported of item.imports ?? []) visit(imported);
};
visit(entryKey);
visit(homeKey);

const brotliBytes = (file) => brotliCompressSync(readFileSync(new URL(file, DIST)), {
  params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
}).byteLength;
const jsBytes = [...assets].filter((file) => file.endsWith(".js"))
  .reduce((total, file) => total + brotliBytes(file), 0);
const cssBytes = [...assets].filter((file) => file.endsWith(".css"))
  .reduce((total, file) => total + brotliBytes(file), 0);
const fonts = readdirSync(new URL("assets/", DIST)).filter((file) => file.endsWith(".woff2"));
const fontBytes = fonts.reduce((total, file) => total + readFileSync(join(new URL("assets/", DIST).pathname, file)).byteLength, 0);

const iconAsset = [...assets].find((file) => file.includes("createLucideIcon") && file.endsWith(".js"));
const iconBytes = iconAsset ? brotliBytes(iconAsset) : 0;
const limits = { js: 160 * 1024, css: 25 * 1024, font: 50 * 1024, icon: 16 * 1024 };
const failures = [];
if (jsBytes > limits.js) failures.push(`Home JS Brotli ${jsBytes} > ${limits.js}`);
if (cssBytes > limits.css) failures.push(`Home CSS Brotli ${cssBytes} > ${limits.css}`);
if (fonts.length !== 1 || fontBytes > limits.font) {
  failures.push(`font assets ${fonts.length}/${fontBytes} bytes exceed 1/${limits.font}`);
}
if (!iconAsset || iconBytes > limits.icon) failures.push(`icon Brotli ${iconBytes} > ${limits.icon}`);

const html = readFileSync(new URL("index.html", DIST), "utf8");
const forbiddenPreloads = ["Fleet3D", "Compare", "Instance", "ThemeManage"];
for (const token of forbiddenPreloads) {
  if (html.includes(token)) failures.push(`index.html preloads non-Home route ${token}`);
}

console.log(JSON.stringify({
  homeJsBrotliBytes: jsBytes,
  homeCssBrotliBytes: cssBytes,
  fonts,
  fontBytes,
  iconAsset,
  iconBrotliBytes: iconBytes,
  initialAssets: [...assets].sort(),
}, null, 2));
if (failures.length > 0) throw new Error(failures.join("; "));
