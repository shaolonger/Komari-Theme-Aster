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
  const width = async (w) => {
    await cdp.call("Emulation.setDeviceMetricsOverride", {
      width: w,
      height: 1402,
      deviceScaleFactor: 1,
      mobile: w < 721,
    });
  };
  const results = [];
  for (const [mode, w] of [
    ["compact", 1199],
    ["standard", 1122],
    ["large", 1536],
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
    await waitUntil(cdp, "[...document.querySelectorAll('.aurora-history i')].some(e=>getComputedStyle(e).backgroundColor==='rgb(245, 31, 77)')", 6000);
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
      if (narrow === 390)
        await captureScreenshot(cdp, `${base}-${mode}-mobile.png`);
    }
    results.push({ mode, width: w, card: box });
  }
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
  writeFileSync(`${base}-verification.json`, JSON.stringify(results, null, 2));
  return { aurora: results };
}
