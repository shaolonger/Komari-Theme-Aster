import { writeFileSync } from "node:fs";

export async function checkCupertinoDense({ cdp, origin, waitUntil, failGate, captureScreenshot, setFixture }) {
  const screenshotBase = process.env.BROWSER_DENSE_SCREENSHOT_BASE;
  const card = ".cupertino-dense-card";
  const measure = (width, height = 900) =>
    cdp.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 721 });
  const waitForCard = () => waitUntil(cdp, `document.querySelector('${card} [data-family="6"] .aurora-speed:not(:disabled)')!==null`, 10000);
  const primaryCard = `${card}[data-node="node-0"]`;
  const click = (selector) => cdp.value(`document.querySelector(${JSON.stringify(selector)}).click()`);

  await measure(1910);
  await cdp.call("Page.navigate", { url: origin });
  await waitUntil(cdp, "document.querySelector('.app-shell')!==null", 10000);
  await cdp.value(`localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem('komaritheme:node-view-mode-session:desktop','list');
    sessionStorage.setItem('komaritheme:node-view-mode-session:mobile','large');`);
  await cdp.call("Page.reload");
  await waitForCard();
  failGate(await cdp.value(`document.documentElement.dataset.themeStyle==='cupertino-dense' &&
    document.documentElement.dataset.layoutStyle==='cupertino' &&
    document.querySelectorAll('.cupertino-overview-card').length===4 &&
    document.querySelector('.cupertino-attention,.cupertino-attention-clear')!==null &&
    document.querySelector('.cupertino-home-search input')!==null &&
    document.querySelector('.cupertino-sidebar,.cupertino-home-heading,.cupertino-home-breadcrumb,.cupertino-view-switch,.node-list-row')===null`),
  "Dense theme lost the Cupertino overview or retained the sidebar, heading or view switch");

  await waitUntil(cdp, `(()=>{
    const card=document.querySelector('${primaryCard}');
    return ['PPFlight LAX Global S2','5.0%','1049','2.91 TB','CTGNet','CMIN2','921.6','908.4'].every(t=>card.textContent.includes(t))
      && card.querySelectorAll('.aurora-history').length===12
      && [...card.querySelectorAll('.aurora-history')].every(strip=>strip.children.length===16)
      && card.querySelectorAll('.aurora-check button').length===2;
  })()`, 10000);

  await click(".cupertino-mobile-menu");
  failGate(await cdp.value("document.querySelectorAll('.cupertino-top-navigation nav a').length===7"), "Dense navigation links missing");
  await cdp.value("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))");
  await waitUntil(cdp, "document.querySelector('.cupertino-top-navigation')===null", 3000);

  const dimensions = [];
  for (const width of [1910, 1672, 1024, 390, 320]) {
    await measure(width);
    await cdp.value("document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(r)))");
    const layout = await cdp.value(`(()=>{
      const card=document.querySelector('${primaryCard}'), box=card.getBoundingClientRect(), styles=getComputedStyle(card);
      const grid=document.querySelector('.home-node-results');
      const bounds=[...card.querySelectorAll('.dense-resource-value,.dense-network-stats,.aurora-quality-row,.aurora-dual')];
      const overflowing=bounds.filter(e=>e.scrollWidth>e.clientWidth+1 || e.getBoundingClientRect().right>box.right)
        .map(e=>[e.className,e.clientWidth,e.scrollWidth]);
      return {width:${width}, cardWidth:Math.round(box.width), height:Math.round(box.height), left:box.left,
        columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        overflow:overflowing.length>0 || document.documentElement.scrollWidth>${width}+1, overflowing,
        border:styles.borderLeftColor===styles.borderRightColor && styles.borderLeftWidth===styles.borderRightWidth,
        white:styles.backgroundColor==='rgb(255, 255, 255)'};
    })()`);
    if (screenshotBase && [1910, 390].includes(width)) {
      await captureScreenshot(cdp, `${screenshotBase}-${width}.png`);
      // The isolated card crop should exclude the page's fixed controls.
      await cdp.value(`(()=>{
        const style=document.createElement('style');
        style.id='dense-card-crop';
        style.textContent='.cupertino-masthead,.cupertino-home-search,.floating-controls{visibility:hidden}';
        document.head.append(style);
      })()`);
      const clip = await cdp.value(`(()=>{const r=document.querySelector('${primaryCard}').getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:2}})()`);
      const screenshot = await cdp.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip });
      writeFileSync(`${screenshotBase}-card-${width}.png`, Buffer.from(screenshot.data, "base64"));
      await cdp.value("document.getElementById('dense-card-crop').remove()");
    }
    failGate(layout.left <= 13 && !layout.overflow && layout.border && layout.white,
      "Dense card overflow, sidebar reservation or status border: " + JSON.stringify(layout));
    if (width === 1910) failGate(layout.columns === 8 && layout.cardWidth <= 240, "Eight cards must fit on a 1910px viewport");
    dimensions.push(layout);
  }

  for (const [selector, heading] of [
    [".aurora-route-section .aurora-pill", "电信 IPv4 去程"],
    ['.aurora-speed-section [data-family="6"] .aurora-speed', "三网测速 · 北京 · IPv6"],
  ]) {
    await click(`${primaryCard} ${selector}`);
    await waitUntil(cdp, `document.querySelector('.network-drawer')?.textContent.includes(${JSON.stringify(heading)})===true`, 5000);
    await click('.network-drawer button[aria-label="关闭面板"]');
  }

  await click(`${primaryCard} .dense-node-actions summary`);
  await click(`${primaryCard} .dense-node-menu button[aria-pressed="false"]`);
  await click(".cupertino-status-filters button:last-child");
  await waitUntil(cdp, `document.querySelectorAll('${card}').length===1`, 4000);
  await click(".cupertino-status-filters button:first-child");
  await click(".floating-controls-trigger");
  await waitUntil(cdp, 'document.querySelector(\'.floating-controls button[aria-label="原生 · 密集"]\')!==null', 4000);
  failGate(await cdp.value(`document.querySelector('.floating-controls [aria-label="节点视图"]')===null`),
    "Dense view picker is still available in floating controls");
  await click('.floating-controls button[aria-label="原生 · Cupertino"]');
  await waitUntil(cdp, `document.querySelector('.cupertino-sidebar') && document.querySelector('.cupertino-view-switch') && document.querySelector('.home-node-results[data-view-mode="large"]')!==null`, 6000);
  await click('.floating-controls button[aria-label="原生 · 密集"]');
  await waitForCard();

  setFixture({ nodes: 1, auroraOffline: true, auroraFamilies: ["4"], auroraRouteFamilies: ["4"], auroraSpeedFamilies: ["6"] });
  await cdp.call("Page.reload");
  await waitUntil(cdp, `document.querySelector('${card} .dense-status[data-online="false"]') &&
    document.querySelector('${card} .aurora-route-section .aurora-dual[data-family-count="1"]') &&
    document.querySelector('${card} .aurora-speed-section [data-family="6"]') &&
    document.querySelector('${card} .aurora-speed-section [data-family="4"]')===null &&
    document.querySelector('${card} .aurora-quality-row [data-family="6"]')===null`, 10000);

  return { cupertinoDense: "full-width fixed cards, dual-stack histories, filters, favorites, theme switching, offline and per-module single-stack", dimensions };
}
