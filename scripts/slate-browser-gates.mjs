import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
export async function checkSlate({ cdp, origin, waitUntil, failGate, captureScreenshot }) {
  const base = process.env.BROWSER_SLATE_SCREENSHOT_BASE;
  const navigate = async (path = "/") => {
    await cdp.call("Page.navigate", { url: origin + path });
    await waitUntil(cdp, "document.querySelector('.app-shell') !== null", 8000);
  };
  const width = async w => {
    await cdp.call("Emulation.setDeviceMetricsOverride", { width: w, height: 1100, deviceScaleFactor: 1, mobile: w < 720 });
    await cdp.value("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))");
  };
  const fits = async label => failGate(await cdp.value("document.documentElement.scrollWidth <= innerWidth + 1"), `Obsidian ${label} overflows`);
  const selectView = async label => {
    await cdp.value("if(document.querySelector('.floating-controls-trigger').getAttribute('aria-expanded') !== 'true') document.querySelector('.floating-controls-trigger').click()");
    await waitUntil(cdp, `document.querySelector('button[aria-label="${label}"]') !== null`, 4000);
    await cdp.value(`document.querySelector('button[aria-label="${label}"]').click(); document.querySelector('.floating-controls-trigger').click()`);
    await waitUntil(cdp, label === "列表" ? "document.querySelector('.node-list-row') !== null" : label === "紧凑卡片" ? "document.querySelector('.compact-node-card') !== null" : "document.querySelector('.server-card') !== null", 5000);
  };
  const switchAppearance = async appearance => {
    await cdp.value(`localStorage.setItem('appearance',JSON.stringify('${appearance}'))`);
    await cdp.call("Page.reload");
    await waitUntil(cdp, `document.documentElement.dataset.appearance === '${appearance === 'slate' || appearance === 'dark' ? 'dark' : 'light'}' && document.querySelector('.server-card,.compact-node-card,.node-list-row') !== null`, 8000);
  };
  await width(1440); await navigate();
  await cdp.value("localStorage.clear();sessionStorage.clear()");
  await switchAppearance("slate");
  await selectView("标准卡片");
  await waitUntil(cdp, "document.querySelector('.carrier-route-evidence')?.textContent.includes('CN2') && document.querySelector('.ping-history-strips') !== null", 8000);
  failGate(await cdp.value("performance.getEntriesByType('resource').filter(r=>r.name.includes('/v3/public/routes')).length === 1"), "Homepage fetched routes once per card instead of once per fleet");
  failGate(await cdp.value("document.documentElement.dataset.themeStyle === 'slate' && document.documentElement.style.colorScheme === 'dark' && document.querySelector('meta[name=theme-color]').content === '#252b34'"), "Obsidian did not restore the dark palette");
  failGate(await cdp.value("document.querySelector('.server-card .ping-source-list').querySelectorAll('.ping-task-tile').length === 3 && document.querySelectorAll('.server-card .ping-history-strip').length >= 6"), "Multi-task latency/loss histories were lost");
  await cdp.value("document.querySelector('.server-card .ping-task-overflow').click()");
  failGate(await cdp.value("document.querySelector('.server-card .ping-source-list').querySelectorAll('.ping-task-tile').length === 4"), "Additional task cannot be expanded");
  await cdp.value("document.querySelector('.server-card .ping-task-show-less').click();document.querySelector('.slate-billing-toggle').click()");
  failGate(await cdp.value("document.querySelector('.slate-billing-panel').textContent.includes('到期') && document.querySelector('.slate-billing-panel').textContent.includes('在线')"), "Billing details were lost");
  await cdp.value("document.querySelector('.slate-billing-toggle').click()");
  failGate(await cdp.value("(()=>{const b=document.querySelector('.slate-billing-toggle').getBoundingClientRect();const s=document.querySelector('.slate-billing-toggle').closest('.home-node-card-slot').getBoundingClientRect();return b.bottom <= s.bottom + 1 && getComputedStyle(document.querySelector('.server-card')).contentVisibility === 'visible';})()"), "Overlapping billing button is clipped by its paint boundary");
  failGate(await cdp.value("document.querySelector('.server-card .carrier-routes').querySelectorAll('.carrier-route-row')[2].querySelector('.carrier-route-evidence > span').textContent === '未探测'"), "Return result was falsely copied into forward direction");
  await cdp.value("Array.from(document.querySelectorAll('.server-card .carrier-family-switch button')).find(b=>b.textContent==='IPv6').click()");
  failGate(await cdp.value("document.querySelector('.server-card .carrier-route-evidence').textContent.includes('163')"), "IPv6 did not select independent results");
  await cdp.value("Array.from(document.querySelectorAll('.server-card .carrier-family-switch button')).find(b=>b.textContent==='IPv4').click()");
  for (const appearance of ["slate", "slate-light"]) {
    await switchAppearance(appearance);
    await waitUntil(cdp, "document.querySelector('.ping-history-strips') !== null", 5000);
    for (const w of [1440, 1024, 390, 320]) {
      await width(w); await selectView("标准卡片"); await fits(`${appearance} standard ${w}`);
      await waitUntil(cdp, "document.querySelector('.server-card .carrier-route-evidence')?.textContent.includes('CN2')", 5000);
      if (base && (w === 1440 || w === 390)) {
        mkdirSync(dirname(base), { recursive: true });
        await captureScreenshot(cdp, `${base}-${appearance}-${w}.png`);
        if (w === 390) {
          await cdp.value("document.querySelector('.server-card').scrollIntoView({block:'start'})");
          await cdp.value("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))");
          const clip = await cdp.value("(()=>{const r=document.querySelector('.server-card').getBoundingClientRect(); return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height+14,scale:2}})()");
          await cdp.value("document.querySelector('.floating-controls').style.visibility='hidden'");
          const shot = await cdp.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip });
          writeFileSync(`${base}-${appearance}-card.png`, Buffer.from(shot.data, "base64"));
          await cdp.value("document.querySelector('.floating-controls').style.visibility=''");
        }
      }
      for (const view of ["扩展卡片", "紧凑卡片", "列表"]) { await selectView(view); await fits(`${appearance} ${view} ${w}`); }
      await selectView("标准卡片");
    }
  }
  // All existing themes use the same real summary and preserve absent directions.
  for (const appearance of ["light", "dark", "system", "diagnostic", "clearsky"]) {
    await cdp.value(`localStorage.setItem('appearance',JSON.stringify('${appearance}'))`);
    await cdp.call("Page.reload");
    await waitUntil(cdp, "document.querySelector('.server-card .carrier-route-evidence')?.textContent.includes('CN2')", 8000);
    await fits(appearance);
  }
  // Save and isolated preview of both new defaults.
  await width(1440); await navigate("/?view=theme-manage");
  for (const appearance of ["slate", "slate-light"]) {
    await waitUntil(cdp, `document.querySelector('input[value="${appearance}"]') !== null`, 8000);
    await cdp.value(`document.querySelector('input[value="${appearance}"]').click()`);
    const storage = await cdp.value("JSON.stringify(Object.entries(localStorage).sort())");
    await cdp.value("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='打开首页预览').click()");
    await waitUntil(cdp, `document.querySelector('.studio-home-preview iframe')?.contentDocument?.documentElement?.dataset.appearance === '${appearance === 'slate' ? 'dark' : 'light'}' && document.querySelector('.studio-home-preview iframe')?.contentDocument?.documentElement?.dataset.themeStyle === 'slate'`, 8000);
    failGate(await cdp.value("JSON.stringify(Object.entries(localStorage).sort())") === storage, "Preview changed personal preferences");
    await cdp.value("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='关闭预览').click()");
    await cdp.value("Array.from(document.querySelectorAll('.aster-studio-savebar button')).find(b=>b.textContent.includes('保存')).click()");
    await waitUntil(cdp, "document.querySelector('.aster-studio-state span')?.dataset.dirty === 'false'", 8000);
  }
  await cdp.value("localStorage.removeItem('appearance');localStorage.removeItem('appearance_default')");
  await navigate();
  await waitUntil(cdp, "document.documentElement.dataset.themeStyle === 'slate' && document.documentElement.dataset.appearance === 'light'", 8000);
  return { obsidian: "dark/light, persisted/default/isolated preview, independent IPv4/IPv6 and directions, multi-task strips, all original appearances, four views at 320–1440px" };
}
