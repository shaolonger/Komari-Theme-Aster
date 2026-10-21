import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Exercise the shipped app, settings and RPC adapters, not the design mockup.
export async function checkClearSky({ cdp, origin, waitUntil, failGate, captureScreenshot }) {
  const shotBase = process.env.BROWSER_CLEAR_SKY_SCREENSHOT_BASE;
  const shot = async (name) => {
    if (!shotBase) return;
    const path = `${shotBase}-${name}.png`;
    mkdirSync(dirname(path), { recursive: true });
    await captureScreenshot(cdp, path);
  };
  const navigate = async (path = "/") => {
    await cdp.call("Page.navigate", { url: origin + path });
    await waitUntil(cdp, "document.querySelector('.app-shell') !== null", 8_000);
  };
  const width = async (w) => {
    await cdp.call("Emulation.setDeviceMetricsOverride", { width: w, height: 1000, deviceScaleFactor: 1, mobile: w < 720 });
    // Let the device-specific view-mode store consume its media-query change
    // before a test clicks a view button for the newly selected device.
    await cdp.value("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  };
  const view = async (mode) => {
    await cdp.value(`document.querySelector('.clear-sky-view-switch button${{ compact: ':nth-child(1)', standard: ':nth-child(2)', large: ':nth-child(3)', list: ':nth-child(4)' }[mode]}').click()`);
    await waitUntil(cdp, mode === "compact" ? "document.querySelector('.compact-node-card .sky-traffic-quota-foot') !== null" : mode === "list" ? "document.querySelector('.node-list-row') !== null" : "document.querySelector('.server-card .sky-traffic-quota-foot') !== null", 6_000);
  };
  const fits = async (label) => failGate(await cdp.value("document.documentElement.scrollWidth <= innerWidth + 1"), `Clear Sky ${label} overflows`);
  await width(1440);
  await navigate();
  await cdp.value(`localStorage.clear(); sessionStorage.clear(); localStorage.setItem('appearance', JSON.stringify('clearsky'))`);
  await cdp.call("Page.reload");
  await waitUntil(cdp, "document.documentElement.dataset.themeStyle === 'clearsky' && document.querySelector('.clear-sky-view-switch') !== null", 8_000);
  failGate(await cdp.value("document.documentElement.dataset.appearance === 'light' && document.documentElement.style.colorScheme === 'light' && document.querySelector('meta[name=theme-color]').content === '#e7f1fc'"), "Clear Sky failed to restore its light palette and browser chrome");
  await view("compact");
  failGate(await cdp.value("document.querySelectorAll('.compact-node-card .sky-traffic-quota').length === document.querySelectorAll('.compact-node-card').length && document.querySelector('.sky-traffic-quota-foot').textContent.includes('剩余') && document.querySelector('.sky-traffic-quota-foot').textContent.includes('已用')"), "Compact cards lost quota totals or percentage");
  failGate(await cdp.value("Array.from(document.querySelectorAll('.sky-traffic-quota-foot')).some(n=>n.textContent.includes('未设限')) && Array.from(document.querySelectorAll('.sky-traffic-quota-foot')).some(n=>/已用 125/.test(n.textContent))"), "Unlimited or over-quota billing was lost");
  await waitUntil(cdp, "!Array.from(document.querySelectorAll('.home-fleet-metric strong')).some(n=>n.textContent.includes('计算中'))", 8_000);
  failGate(await cdp.value("document.querySelectorAll('.cost-summary-detail-item').length === 0"), "Closed asset panel rendered hidden details");
  await cdp.value("document.querySelector('button[title=\"打开资产统计\"]').click()");
  await waitUntil(cdp, "document.querySelectorAll('.cost-summary-detail-item').length === 8", 4_000);
  await cdp.value("document.querySelector('button[aria-label=\"关闭服务器花费\"]').click()");
  await waitUntil(cdp, "document.querySelectorAll('.cost-summary-detail-item').length === 0", 4_000);
  for (const w of [1440, 1024, 390, 320]) {
    await width(w);
    await waitUntil(cdp, "document.querySelector('.clear-sky-view-switch') !== null", 3_000);
    await view("compact"); await fits(`compact ${w}px`);
    if (w === 1440 || w === 390) await shot(`compact-${w}`);
    await view("large"); await fits(`large ${w}px`);
    if (w === 1440) await shot("large");
    await view("list"); await fits(`list ${w}px`);
  }
  await cdp.call("Emulation.setTouchEmulationEnabled", { enabled: false });
  await width(1440); await view("compact");
  await cdp.value("document.querySelector('.compact-node-card').scrollIntoView({block:'center'})");
  // content-visibility can replace an intrinsic placeholder on scroll. Measure
  // after layout has settled, not before revealing the offscreen card.
  await new Promise(resolve => setTimeout(resolve, 350));
  const center = await cdp.value(`(() => { const r=document.querySelector('.compact-node-card').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+Math.min(50,r.height/2)}; })()`);
  console.log("Clear Sky input", await cdp.value(`({fine:matchMedia('(hover: hover) and (pointer: fine)').matches,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,hitCard:!!document.elementFromPoint(${center.x},${center.y})?.closest('.compact-node-card')})`));
  await cdp.call("Input.dispatchMouseEvent", { type: "mouseMoved", pointerType: "mouse", ...center });
  await waitUntil(cdp, "document.querySelector('.sky-is-tilted') !== null", 3_000);
  await cdp.call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  await waitUntil(cdp, "document.querySelector('.sky-is-tilted') === null && matchMedia('(pointer: coarse)').matches", 3_000);
  failGate(await cdp.value("getComputedStyle(document.querySelector('.compact-node-card')).transform === 'none'"), "Touch input did not disable 3D transforms");
  await cdp.call("Emulation.setTouchEmulationEnabled", { enabled: false });
  await cdp.value("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await cdp.call("Input.dispatchMouseEvent", { type: "mouseMoved", pointerType: "mouse", x: 0, y: 0 });
  await cdp.call("Input.dispatchMouseEvent", { type: "mouseMoved", pointerType: "mouse", ...center });
  await waitUntil(cdp, "document.querySelector('.sky-is-tilted') !== null", 3_000);
  await cdp.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await waitUntil(cdp, "document.querySelector('.sky-is-tilted') === null", 3_000);
  failGate(await cdp.value("getComputedStyle(document.querySelector('.compact-node-card')).transform === 'none'"), "Reduced motion did not disable 3D transforms");
  await cdp.call("Emulation.setEmulatedMedia", { features: [] });
  await navigate("/instance/node-1");
  await waitUntil(cdp, "document.querySelectorAll('.instance-chart-card').length > 0", 8_000);
  await cdp.value("Array.from(document.querySelectorAll('button')).find(b => b.textContent.replace(/\\s/g, '') === '1小时').click()");
  await waitUntil(cdp, "Number(document.querySelector('[aria-label=\"图表数据范围\"]')?.textContent.match(/采样\\s*(\\d+)/)?.[1]) > 1", 8_000);
  await waitUntil(cdp, "Array.from(document.querySelectorAll('.instance-uplot-wrap')).every(w => { const plot=w.querySelector('.uplot');return plot && plot.getBoundingClientRect().width <= w.clientWidth + 1; })", 4_000);
  await shot("detail-load");
  for (const w of [1024, 390, 320]) {
    await width(w); await fits(`load detail ${w}px`);
    await waitUntil(cdp, "Array.from(document.querySelectorAll('.instance-uplot-wrap')).every(w => { const plot=w.querySelector('.uplot');return plot && plot.getBoundingClientRect().width <= w.clientWidth + 1; })", 4_000);
  }
  await width(1440);
  await cdp.value("Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Ping').click()");
  await waitUntil(cdp, "document.querySelector('.instance-ping-task') !== null", 6_000);
  await shot("detail-ping");
  for (const w of [1024, 390, 320]) { await width(w); await fits(`Ping detail ${w}px`); }
  await width(1440);
  await navigate("/?view=theme-manage");
  await waitUntil(cdp, "document.querySelector('.studio-visual-options input[value=clearsky]') !== null", 8_000);
  // Preview must apply the new default without changing the outer preference.
  await cdp.value("document.querySelector('.studio-visual-options input[value=clearsky]').click()");
  const outerStorage = await cdp.value("JSON.stringify(Object.entries(localStorage).sort())");
  await cdp.value("Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '打开首页预览').click()");
  await waitUntil(cdp, "document.querySelector('.studio-home-preview iframe')?.contentDocument?.documentElement.dataset.themeStyle === 'clearsky'", 8_000);
  failGate(await cdp.value("JSON.stringify(Object.entries(localStorage).sort())") === outerStorage, "Studio preview changed outer preferences");
  await cdp.value("Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '关闭预览').click()");
  await cdp.value("Array.from(document.querySelectorAll('.aster-studio-savebar button')).find(b => b.textContent.includes('保存')).click()");
  await waitUntil(cdp, "document.querySelector('.aster-studio-state span')?.dataset.dirty === 'false'", 8_000);
  await shot("studio");
  await cdp.value("localStorage.removeItem('appearance'); localStorage.removeItem('appearance_default')");
  await navigate();
  await waitUntil(cdp, "document.documentElement.dataset.themeStyle === 'clearsky' && document.querySelector('.clear-sky-view-switch') !== null", 8_000);
  for (const appearance of ["dark", "light", "diagnostic", "system", "clearsky"]) {
    await width(320);
    await cdp.value("document.querySelector('.floating-controls-trigger').click()");
    const label = { dark: "深色", light: "浅色", diagnostic: "诊断", system: "跟随系统", clearsky: "澄空" }[appearance];
    await waitUntil(cdp, `document.querySelector('button[aria-label="${label}"]') !== null`, 4_000);
    await cdp.value(`document.querySelector('button[aria-label="${label}"]').click()`);
    await waitUntil(cdp, `JSON.parse(localStorage.getItem('appearance')) === '${appearance}'`, 4_000);
    await waitUntil(cdp, "['主题设置', '管理'].every(label=>{const item=document.querySelector('.floating-controls-actions [aria-label=\"'+label+'\"]');const box=document.querySelector('.floating-controls-actions').getBoundingClientRect();const r=item?.getBoundingClientRect();return r && r.left>=box.left-1 && r.right<=box.right+1;})", 4_000);
    failGate(await cdp.value(`document.documentElement.dataset.themeStyle === '${appearance === "diagnostic" || appearance === "clearsky" ? appearance : "default"}'`), `Appearance switch ${appearance} failed`);
    if (appearance !== "clearsky") failGate(await cdp.value("document.querySelector('.clear-sky-backdrop') === null"), "Clear Sky layer leaked into another appearance");
    await cdp.value("if (document.querySelector('.floating-controls-trigger').getAttribute('aria-expanded') === 'true') document.querySelector('.floating-controls-trigger').click()");
  }
  return { clearSky: "persisted/default appearance, Studio save/isolated preview, compact quota, four views, load/Ping, 320–1440px, pointer/reduced motion, original appearances" };
}
