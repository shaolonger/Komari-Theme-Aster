import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
export async function checkAurora({
  cdp,
  origin,
  waitUntil,
  failGate,
  captureScreenshot,
  count,
  setFixture,
}) {
  const base =
    process.env.BROWSER_AURORA_SCREENSHOT_BASE || "/tmp/aurora-reference";
  mkdirSync(dirname(base), { recursive: true });
  await cdp.call("Page.navigate", { url: origin });
  await waitUntil(cdp, "document.querySelector('.app-shell')!==null", 10000);
  const modeKey = "komaritheme:node-view-mode-session:";
  const width = async (w, height = 1402) => {
    await cdp.call("Emulation.setDeviceMetricsOverride", {
      width: w,
      height,
      deviceScaleFactor: 1,
      mobile: w < 721,
    });
  };
  const results = [];
  const frameExpression = `(()=>({
    background:getComputedStyle(document.body).backgroundColor,
    accent:getComputedStyle(document.documentElement).getPropertyValue('--accent-500').trim(),
    sections:['.cupertino-sidebar','.cupertino-masthead','.cupertino-home-search','.cupertino-overview','.cupertino-toolbar'].map(selector=>{
      const e=document.querySelector(selector),r=e.getBoundingClientRect(),s=getComputedStyle(e);
      return {selector,x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height),background:s.backgroundColor,color:s.color,font:s.fontFamily};
    })
  }))()`;
  // Both pages must scroll so the native scrollbar consumes the same width.
  await width(1672, 500);
  await cdp.value(
    `localStorage.setItem('appearance',JSON.stringify('cupertino'));sessionStorage.setItem('${modeKey}desktop','standard');sessionStorage.setItem('${modeKey}mobile','standard')`,
  );
  await cdp.call("Page.reload");
  await waitUntil(
    cdp,
    "document.querySelectorAll('.cupertino-overview-card').length===4 && document.querySelector('.cupertino-node-card')!==null",
    15000,
  );
  await cdp.value("document.fonts.ready.then(()=>true)");
  const cupertinoFrame = await cdp.value(frameExpression);
  const headingSpace = await cdp.value(
    "(()=>{const e=document.querySelector('.cupertino-home-heading'),s=getComputedStyle(e);return e.getBoundingClientRect().height+parseFloat(s.marginTop)+parseFloat(s.marginBottom)})()",
  );
  for (const section of cupertinoFrame.sections)
    if (
      [".cupertino-overview", ".cupertino-toolbar"].includes(section.selector)
    )
      section.y = Math.round(section.y - headingSpace);
  await cdp.value(
    "localStorage.setItem('appearance',JSON.stringify('aurora'))",
  );
  await cdp.call("Page.reload");
  await waitUntil(
    cdp,
    "document.querySelectorAll('.cupertino-overview-card').length===4 && document.querySelector('.aurora-node-card')!==null && document.documentElement.dataset.layoutStyle==='cupertino'",
    15000,
  );
  await cdp.value("document.fonts.ready.then(()=>true)");
  const auroraFrame = await cdp.value(frameExpression);
  failGate(
    await cdp.value("document.querySelector('.cupertino-home-heading')===null"),
    "Aurora must omit the redundant page heading and tagline",
  );
  await captureScreenshot(cdp, `${base}-workspace.png`);
  failGate(
    JSON.stringify(auroraFrame) === JSON.stringify(cupertinoFrame),
    "Aurora workspace must match the Cupertino navigation, overview and toolbar: " +
      JSON.stringify({ cupertinoFrame, auroraFrame }),
  );
  failGate(
    await cdp.value(
      "getComputedStyle(document.querySelector('.home-command-area')).display==='none' && document.querySelector('.home-workbench')===null",
    ),
    "Legacy workspace remains visible in Aurora",
  );
  await cdp.value(
    "document.querySelectorAll('.cupertino-status-filters button')[2].click()",
  );
  await waitUntil(
    cdp,
    "document.querySelector('.home-filter-empty')!==null && document.querySelector('.aurora-node-card')===null",
    6000,
  );
  await cdp.value(
    "document.querySelectorAll('.cupertino-status-filters button')[0].click()",
  );
  await waitUntil(
    cdp,
    "document.querySelector('.aurora-node-card')!==null",
    6000,
  );
  for (const [mode, w] of [
    ["compact", 1408],
    ["standard", 1326],
    ["large", 1768],
  ]) {
    await width(w);
    await cdp.value(
      `localStorage.setItem('appearance',JSON.stringify('aurora'));sessionStorage.setItem('${modeKey}desktop','${mode}');sessionStorage.setItem('${modeKey}mobile','${mode}');`,
    );
    await cdp.call("Page.reload");
    await waitUntil(
      cdp,
      `document.querySelector('.aurora-node-card[data-mode="${mode}"]') && document.querySelectorAll('.aurora-pill:not(:disabled)').length===12 && document.querySelectorAll('.aurora-speed:not(:disabled)').length===12 && document.querySelector('.aurora-history i')!==null`,
      15000,
    );
    await cdp.value("document.fonts.ready.then(()=>true)");
    await waitUntil(
      cdp,
      "[...document.querySelectorAll('.aurora-history i')].some(e=>getComputedStyle(e).backgroundColor==='rgb(245, 31, 77)')",
      6000,
    );
    if (mode !== "compact")
      await waitUntil(
        cdp,
        "document.querySelector('.aurora-check button')!==null",
        6000,
      );
    // Crop to the actual card so the reference can be compared independently
    // of the existing fleet toolbar, search and site-wide controls.
    await cdp.value(
      "document.querySelector('.aurora-node-card').scrollIntoView({block:'start'})",
    );
    const box = await cdp.value(
      "(()=>{const r=document.querySelector('.aurora-node-card').getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1}})()",
    );
    const shot = await cdp.call("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: box,
    });
    writeFileSync(`${base}-${mode}.png`, Buffer.from(shot.data, "base64"));
    await cdp.value("window.scrollTo(0,0)");
    const fullPage = await cdp.call("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: await cdp.value(
        "({x:0,y:0,width:innerWidth,height:document.documentElement.scrollHeight,scale:1})",
      ),
    });
    writeFileSync(
      `${base}-${mode}-page.png`,
      Buffer.from(fullPage.data, "base64"),
    );
    failGate(
      (await cdp.value(
        "document.querySelector('.aurora-summary').textContent.includes('PPFlight LAX Global S2') && document.querySelector('.aurora-summary').textContent.includes('1049')",
      )) || mode === "large",
      "Node metrics missing",
    );
    failGate(
      await cdp.value(
        "document.querySelectorAll('.aurora-history').length===6 || document.querySelectorAll('.aurora-history').length===12",
      ),
      "Six dual-stack quality histories missing",
    );
    failGate(
      await cdp.value(
        "document.querySelector('.aurora-network').textContent.includes('CTGNet') && document.querySelector('.aurora-network').textContent.includes('CMIN2')",
      ),
      "IPv6 routes lost",
    );
    failGate(
      await cdp.value(
        "document.querySelector('.aurora-network').textContent.includes('921.6') && document.querySelector('.aurora-network').textContent.includes('908.4')",
      ),
      "IPv4 / IPv6 speed values lost",
    );
    // A real evidence dialog must open, not a decorative route badge.
    await cdp.value(
      "document.querySelector('.aurora-pill:not(:disabled)').click()",
    );
    await waitUntil(cdp, "document.querySelector('dialog[open]')!==null", 6000);
    await cdp.value(
      "document.querySelector('dialog[open] button[aria-label*=关闭]')?.click() || [...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent.includes('关闭'))?.click()",
    );
    await waitUntil(cdp, "document.querySelector('dialog[open]')===null", 3000);
    await cdp.value(
      "document.querySelector('.aurora-speed:not(:disabled)').click()",
    );
    await waitUntil(
      cdp,
      "document.querySelector('dialog[open]')?.textContent.includes('P1 单连接')===true",
      6000,
    );
    await cdp.value(
      "document.querySelector('dialog[open] button[aria-label=关闭面板]').click()",
    );
    await waitUntil(cdp, "document.querySelector('dialog[open]')===null", 3000);
    if (mode === "standard" || mode === "compact") {
      await cdp.value(
        "(()=>{const s=document.querySelector('select[aria-label=测速地区]');s.value='上海';s.dispatchEvent(new Event('change',{bubbles:true}))})()",
      );
      await waitUntil(
        cdp,
        "document.querySelector('.aurora-network').textContent.includes('821.6')",
        3000,
      );
      await cdp.value(
        "(()=>{const s=document.querySelector('select[aria-label=测速地区]');s.value='北京';s.dispatchEvent(new Event('change',{bubbles:true}))})()",
      );
    }
    if (mode !== "standard")
      for (const panel of ["quality", "routes", "speeds", "all"]) {
        await cdp.value(
          `document.querySelectorAll('.aurora-tabs button')[${["all", "quality", "routes", "speeds"].indexOf(panel)}].click()`,
        );
        await waitUntil(
          cdp,
          `document.querySelector('.aurora-network').dataset.panel==='${panel}'`,
          3000,
        );
        failGate(
          await cdp.value("document.documentElement.scrollWidth<=innerWidth+1"),
          "Panel overflow: " + mode + "/" + panel,
        );
      }
    for (const narrow of [768, 390, 320]) {
      await width(narrow);
      await cdp.value(
        "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
      );
      const geometry = await cdp.value(
        "({viewport:innerWidth,document:document.documentElement.scrollWidth,card:document.querySelector('.aurora-node-card').getBoundingClientRect().width,overflow:[...document.querySelectorAll('.aurora-node-card *')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.right>innerWidth+1}).slice(0,8).map(e=>e.className)})",
      );
      failGate(
        geometry.document <= narrow + 1,
        `Aurora ${mode} ${narrow}px overflow: ${JSON.stringify(geometry)}`,
      );
      const escaped = await cdp.value(
        "(()=>{const card=document.querySelector('.aurora-node-card'),bounds=card.getBoundingClientRect();return [...card.querySelectorAll('*')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0 && (r.right>bounds.right+1 || r.left<bounds.left-1)}).slice(0,6).map(e=>e.getAttribute('class'))})()",
      );
      failGate(
        escaped.length === 0,
        `Aurora ${mode} ${narrow}px contents escaped the card: ${JSON.stringify(escaped)}`,
      );
      if (narrow === 390)
        await captureScreenshot(cdp, `${base}-${mode}-mobile.png`);
    }
    results.push({ mode, width: w, card: box });
  }
  const fleetLayouts = [];
  setFixture({ nodes: 8 });
  for (const [mode, minColumns, maxWidth] of [
    ["compact", 4, 380],
    ["standard", 3, 480],
    ["large", 2, 840],
  ]) {
    await width(1672, 1100);
    await cdp.value(
      `sessionStorage.setItem('${modeKey}desktop','${mode}');sessionStorage.setItem('${modeKey}mobile','${mode}')`,
    );
    await cdp.call("Page.reload");
    await waitUntil(
      cdp,
      `document.querySelectorAll('.aurora-node-card[data-mode="${mode}"]').length===8 && document.querySelectorAll('.aurora-pill:not(:disabled)').length===96`,
      15000,
    );
    const geometry = await cdp.value(
      `(()=>{const grid=document.querySelector('.home-node-results'),cards=[...document.querySelectorAll('.aurora-node-card')],rects=cards.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}});return {gridWidth:grid.getBoundingClientRect().width,columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,cards:rects}})()`,
    );
    failGate(
      geometry.columns >= minColumns,
      `Aurora ${mode}: expected at least ${minColumns} desktop columns: ${JSON.stringify(geometry)}`,
    );
    failGate(
      geometry.cards.every(
        (r) => r.width <= maxWidth + 1 && r.width < geometry.gridWidth * 0.65,
      ),
      `Aurora ${mode}: card expanded to the row width`,
    );
    failGate(
      geometry.cards.every((r) => r.height < 900),
      `Aurora ${mode}: card spacing is excessive: ${JSON.stringify(geometry)}`,
    );
    await cdp.value("window.scrollTo(0,0)");
    await captureScreenshot(cdp, `${base}-${mode}-fleet.png`);
    fleetLayouts.push({ mode, ...geometry });
    if (mode === "standard") {
      await cdp.value(
        "(()=>{const input=document.querySelector('.cupertino-home-search input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'PPFlight LAX Global S2');input.dispatchEvent(new Event('input',{bubbles:true}))})()",
      );
      await waitUntil(
        cdp,
        "document.querySelectorAll('.aurora-node-card').length===1",
        6000,
      );
      failGate(
        await cdp.value(
          "document.querySelector('.aurora-node-card').getBoundingClientRect().width<=480",
        ),
        "A single search result expanded to full width",
      );
    }
  }
  setFixture({ nodes: 1 });
  await cdp.call("Page.reload");
  await waitUntil(
    cdp,
    "document.querySelectorAll('.aurora-node-card').length===1",
    6000,
  );
  await width(390);
  await cdp.value(
    'window.scrollTo(0,0);document.querySelector(".cupertino-mobile-menu").click()',
  );
  await waitUntil(
    cdp,
    "document.querySelector('.cupertino-sidebar').dataset.open==='true'",
    3000,
  );
  await cdp.value(
    "document.querySelector('.cupertino-drawer-backdrop').click()",
  );
  await waitUntil(
    cdp,
    "document.querySelector('.cupertino-sidebar').dataset.open==='false'",
    3000,
  );
  // Themes loaded in the same page must relinquish all Aurora geometry.
  await width(1536);
  await cdp.value(
    "document.querySelector('.floating-controls-trigger').click()",
  );
  await waitUntil(
    cdp,
    "document.querySelector('button[aria-label=浅色]')!==null",
    3000,
  );
  for (const [label, style] of [
    ["浅色", "default"],
    ["极光玻璃", "aurora"],
    ["深色", "default"],
    ["极光玻璃", "aurora"],
  ]) {
    await cdp.value(
      `document.querySelector('button[aria-label="${label}"]').click()`,
    );
    await waitUntil(
      cdp,
      `document.documentElement.dataset.themeStyle==='${style}'`,
      6000,
    );
  }
  await waitUntil(
    cdp,
    "document.querySelector('.aurora-check button')!==null",
    6000,
  );
  const before = count("card-check-start");
  await cdp.value(
    "(()=>{const b=document.querySelector('.aurora-check button');b.click();b.click()})()",
  );
  await waitUntil(
    cdp,
    "document.querySelectorAll('.aurora-check [role=progressbar]').length===2",
    5000,
  );
  failGate(
    count("card-check-start") === before + 2,
    "Dual-stack action must start each family once",
  );
  await waitUntil(
    cdp,
    "document.querySelectorAll('.aurora-check .carrier-check-status').length===2 && [...document.querySelectorAll('.aurora-check .carrier-check-status')].every(e=>e.textContent.includes('已完成'))",
    20000,
  );

  for (const [state, assertion] of [
    [
      { auroraGuest: true },
      "document.querySelectorAll('.aurora-check').length===0 && document.querySelectorAll('.aurora-pill:not(:disabled)').length===12",
    ],
    [
      { auroraGuest: false, auroraOffline: true },
      "document.querySelector('.aurora-status').textContent==='离线' && [...document.querySelectorAll('.aurora-rates strong')].every(e=>e.textContent==='—')",
    ],
    [
      { auroraOffline: false, auroraEmpty: true },
      "document.querySelectorAll('.aurora-pill:not(:disabled),.aurora-speed:not(:disabled)').length===0 && document.querySelector('.aurora-empty')!==null",
    ],
    [
      { auroraEmpty: false, auroraHidden: true },
      "document.querySelectorAll('.aurora-pill,.aurora-speed').length===0 && document.querySelectorAll('.aurora-history').length===12",
    ],
    [
      { auroraHidden: false },
      "document.querySelectorAll('.aurora-pill:not(:disabled)').length===12",
    ],
  ]) {
    setFixture(state);
    await cdp.call("Page.reload");
    await waitUntil(
      cdp,
      "document.querySelector('.aurora-network')!==null",
      6000,
    );
    await waitUntil(cdp, assertion, 10000);
    failGate(
      await cdp.value("document.documentElement.scrollWidth<=innerWidth+1"),
      "Edge-state overflow: " + JSON.stringify(state),
    );
  }
  setFixture({ comprehensive: true });
  for (const [name, path, ready] of [
    [
      "instance",
      "/instance/node-0",
      "document.querySelector('.cupertino-instance-metrics')!==null && document.querySelectorAll('.instance-chart-card .uplot').length>=4",
    ],
    [
      "ping",
      "/instance/node-0?focus=ping",
      "document.querySelectorAll('.instance-ping-task').length===6 && document.querySelector('.luminous-event-cards')!==null",
    ],
    [
      "settings",
      "/?view=theme-manage",
      "document.querySelector('.aster-studio')!==null",
    ],
  ]) {
    await width(1672);
    await cdp.call("Page.navigate", { url: origin + path });
    await waitUntil(cdp, ready, 15000);
    failGate(
      await cdp.value(
        "document.querySelector('.cupertino-sidebar')!==null && document.documentElement.dataset.layoutStyle==='cupertino'",
      ),
      "Cupertino workspace missing on " + name,
    );
    await cdp.value("window.scrollTo(0,0)");
    await captureScreenshot(cdp, `${base}-${name}.png`);
    for (const w of [1672, 390]) {
      await width(w);
      await cdp.value(
        "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
      );
      failGate(
        await cdp.value("document.documentElement.scrollWidth<=innerWidth+1"),
        `Aurora ${name} ${w}px overflow`,
      );
    }
  }
  writeFileSync(
    `${base}-verification.json`,
    JSON.stringify({ cupertinoFrame, layouts: results, fleetLayouts }, null, 2),
  );
  return { aurora: results };
}
