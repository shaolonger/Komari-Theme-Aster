import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export async function checkLuminous({
  cdp,
  origin,
  waitUntil,
  failGate,
  captureScreenshot,
  enableNetworkCards,
  reference = Boolean(process.env.BROWSER_LUMINOUS_REFERENCE),
}) {
  if (reference) {
    await cdp.call("Emulation.setDeviceMetricsOverride", {
      width: 1672,
      height: 941,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.call("Page.navigate", { url: origin });
    await waitUntil(cdp, "document.querySelector('.app-shell')!==null", 10000);
    await cdp.value(
      "localStorage.clear();sessionStorage.clear();localStorage.setItem('appearance',JSON.stringify('luminous'));localStorage.setItem('luminous-motion','paused')",
    );
    await cdp.call("Page.reload");
    const base =
      process.env.BROWSER_LUMINOUS_SCREENSHOT_BASE || "/tmp/luminous-reference";
    mkdirSync(dirname(base), { recursive: true });
    const measurements = {};
    for (const [name, path, ready, selectors] of [
      [
        "home",
        "/",
        "document.querySelectorAll('.luminous-reference-card').length===49 && document.querySelector('.luminous-earth canvas')?.dataset.renderer==='webgl'",
        [
          ".app-main",
          ".luminous-hero",
          ".luminous-global",
          ".luminous-bandwidth",
          ".luminous-hero-right",
          ".luminous-notices",
          ".luminous-toolbar",
          ".luminous-reference-card",
        ],
      ],
      [
        "instance",
        "/instance/node-0",
        "document.querySelectorAll('.instance-chart-card .uplot').length===6",
        [
          ".instance-topbar",
          ".luminous-instance-metrics",
          ".instance-chart-workspace",
          ".luminous-asset-panel",
          ".instance-info-groups",
        ],
      ],
      [
        "ping",
        "/instance/node-0?focus=ping",
        "document.querySelectorAll('.instance-ping-task').length===6 && document.querySelector('.orbital-event-timeline')!==null",
        [
          ".instance-topbar",
          ".luminous-ping-summary",
          ".instance-ping-panel>.instance-uplot-wrap",
          ".instance-ping-task-groups",
          ".luminous-event-cards",
          ".glacier-anomaly-summary",
        ],
      ],
    ]) {
      await cdp.call("Page.navigate", { url: origin + path });
      await waitUntil(cdp, ready, 15000);
      await cdp.value(
        "document.fonts.ready.then(()=>new Promise(r=>setTimeout(r,600)))",
      );
      await cdp.value(
        "window.scrollTo(0,0);if(document.activeElement instanceof HTMLElement)document.activeElement.blur()",
      );
      await captureScreenshot(cdp, base + "-" + name + ".png");
      measurements[name] = await cdp.value(
        `Object.fromEntries(${JSON.stringify(selectors)}.map(s=>{const e=document.querySelector(s),r=e?.getBoundingClientRect();return [s,r?{x:r.x,y:r.y,width:r.width,height:r.height}:null]}))`,
      );
    }
    failGate(
      await cdp.value(
        "document.querySelectorAll('.luminous-network-node-label').length===1",
      ),
      "Diagnostic scene must have one node label",
    );
    const home = measurements.home,
      detail = measurements.instance,
      ping = measurements.ping;
    failGate(
      Math.abs(home[".luminous-reference-card"].y - 428) <= 2 &&
        home[".luminous-reference-card"].height === 236,
      "Reference card geometry drifted",
    );
    failGate(
      Math.abs(home[".luminous-global"].x - 203) <= 2 &&
        Math.abs(home[".luminous-global"].y - 73) <= 2,
      "Reference hero geometry drifted",
    );
    failGate(
      Math.abs(detail[".luminous-instance-metrics"].width - 822) <= 2 &&
        Math.abs(detail[".instance-chart-workspace"].y - 334) <= 2,
      "Reference instance geometry drifted",
    );
    failGate(
      Math.abs(ping[".luminous-ping-summary"].y - 193) <= 2 &&
        Math.abs(ping[".instance-ping-task-groups"].x - 1175) <= 3,
      "Reference diagnostic columns drifted",
    );
    return { luminousReference: measurements };
  }
  const base = process.env.BROWSER_LUMINOUS_SCREENSHOT_BASE;
  const shot = async (name) => {
    if (base) {
      await cdp.value(
        "if(document.activeElement instanceof HTMLElement)document.activeElement.blur()",
      );
      const path = `${base}-${name}.png`;
      mkdirSync(dirname(path), { recursive: true });
      await cdp.value("window.scrollTo(0,0)");
      await captureScreenshot(cdp, path);
    }
  };
  const navigate = async (path = "/") => {
    await cdp.call("Page.navigate", { url: origin + path });
    await waitUntil(cdp, "document.querySelector('.app-shell')!==null", 10000);
  };
  const width = async (w) => {
    await cdp.call("Emulation.setDeviceMetricsOverride", {
      width: w,
      height: 1152,
      deviceScaleFactor: 1,
      mobile: w < 720,
    });
    await cdp.value(
      "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
    );
  };
  const fits = async (label) =>
    failGate(
      await cdp.value("document.documentElement.scrollWidth<=innerWidth+1"),
      `Luminous ${label} overflows`,
    );
  const view = async (label, selector) => {
    await cdp.value(
      `(()=>{const s=document.querySelector('.luminous-view-switch select');s.value=${JSON.stringify({ 标准卡片: "standard", 紧凑卡片: "compact", 大卡片: "large", 列表: "list" }[label])};s.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await waitUntil(cdp, `document.querySelector('${selector}')!==null`, 6000);
  };
  await width(2048);
  await navigate();
  await cdp.value(
    `localStorage.clear();sessionStorage.clear();localStorage.setItem('appearance',JSON.stringify('luminous'))`,
  );
  await cdp.call("Page.reload");
  await waitUntil(
    cdp,
    "document.querySelectorAll('.server-card').length===15 && document.querySelector('.luminous-bandwidth path')!==null && document.querySelector('.luminous-earth canvas')?.dataset.renderer==='webgl'",
    10000,
  );
  failGate(
    await cdp.value(
      "document.documentElement.dataset.themeStyle==='luminous' && document.documentElement.dataset.appearance==='light' && document.querySelector('meta[name=theme-color]').content==='#eaf3ff'",
    ),
    "Luminous did not restore its independent light palette",
  );
  await waitUntil(
    cdp,
    "document.querySelector('.luminous-earth canvas')?.dataset.running==='true'",
    5000,
  );
  failGate(
    await cdp.value(
      "getComputedStyle(document.querySelector('.luminous-device-float')).transform !== 'none'",
    ),
    "Luminous device lost its 3D transform",
  );
  await cdp.value(
    "window.__luminousCanvasBefore=document.querySelector('.luminous-earth canvas').toDataURL();null",
  );
  const frame = await cdp.value(
    "Number(document.querySelector('.luminous-earth canvas').dataset.frame)",
  );
  await waitUntil(
    cdp,
    "Number(document.querySelector('.luminous-earth canvas').dataset.frame)>" +
      frame,
    3000,
  );
  failGate(
    await cdp.value(
      "document.querySelector('.luminous-earth canvas').toDataURL() !== window.__luminousCanvasBefore",
    ),
    "Earth frame pixels did not change",
  );
  await cdp.value(
    "delete window.__luminousCanvasBefore;document.querySelector('.luminous-motion-toggle').click()",
  );
  await waitUntil(
    cdp,
    "document.querySelector('.luminous-earth canvas').dataset.running==='false'",
    3000,
  );
  failGate(
    await cdp.value(
      "getComputedStyle(document.querySelector('.luminous-orbit>i')).animationPlayState==='paused'",
    ),
    "Pause did not stop the orbital scene",
  );
  const pausedFrame = await cdp.value(
    "Number(document.querySelector('.luminous-earth canvas').dataset.frame)",
  );
  await cdp.value("new Promise(r=>setTimeout(r,180))");
  failGate(
    await cdp.value(
      "Number(document.querySelector('.luminous-earth canvas').dataset.frame) === " +
        pausedFrame,
    ),
    "Paused Earth kept rendering",
  );
  await shot("overview");
  await width(1672);
  await shot("reference");
  await width(2048);
  await cdp.value("document.querySelector('.luminous-motion-toggle').click()");
  await cdp.call("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await waitUntil(
    cdp,
    "document.querySelector('.luminous-earth canvas').dataset.running==='false'",
    3000,
  );
  failGate(
    await cdp.value(
      "getComputedStyle(document.querySelector('.luminous-device-float')).animationName==='none'",
    ),
    "Reduced motion did not disable device animation",
  );
  await cdp.call("Emulation.setEmulatedMedia", { features: [] });
  await waitUntil(
    cdp,
    "document.querySelector('.luminous-earth canvas').dataset.running==='true'",
    3000,
  );
  await cdp.call("Network.enable");
  await cdp.call("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.call("Network.emulateNetworkConditions", {
    offline: false,
    latency: 500,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  await cdp.value("document.querySelector('.luminous-global').click()");
  await waitUntil(
    cdp,
    "document.querySelector('.home-overview-panel[role=status]')!==null",
    3000,
  );
  await cdp.call("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await waitUntil(
    cdp,
    "document.querySelector('.home-overview-panel')===null",
    3000,
  );
  await cdp.call("Network.emulateNetworkConditions", {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  await cdp.call("Network.setCacheDisabled", { cacheDisabled: false });
  await cdp.value("document.querySelector('.luminous-global').click()");
  await waitUntil(
    cdp,
    "document.querySelectorAll('.home-overview-panel.show .home-overview-row').length===15",
    6000,
  );
  const trigger = await cdp.value(
    "(()=>{const r=document.querySelector('.luminous-global').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()",
  );
  await cdp.call("Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...trigger,
    button: "left",
    clickCount: 1,
  });
  await cdp.call("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    ...trigger,
    button: "left",
    clickCount: 1,
  });
  await waitUntil(
    cdp,
    "document.querySelectorAll('.home-overview-panel.show .home-overview-row').length===15",
    3000,
  );
  await cdp.value("document.querySelector('.home-overview-close').click()");
  await waitUntil(
    cdp,
    "document.querySelector('.home-overview-panel')===null",
    3000,
  );
  await cdp.value("document.querySelector('.luminous-card-favorite').click()");
  await cdp.value(
    "document.querySelector('.luminous-status-filters button:last-child').click()",
  );
  await waitUntil(
    cdp,
    "document.querySelectorAll('.luminous-reference-card').length===1",
    4000,
  );
  failGate(
    await cdp.value(
      "JSON.parse(localStorage.getItem('aster-luminous-favorites')).length===1",
    ),
    "Favorite did not persist",
  );
  await cdp.value(
    "document.querySelector('.luminous-status-filters button').click()",
  );
  await waitUntil(
    cdp,
    "document.querySelectorAll('.luminous-reference-card').length===15",
    4000,
  );
  await cdp.value("document.querySelector('.luminous-card-expand').click()");
  await waitUntil(
    cdp,
    "document.querySelector('.luminous-expanded-card .metric-detail')!==null",
    6000,
  );
  failGate(
    await cdp.value(
      "document.querySelector('.luminous-expanded-card').textContent.includes('CPU')",
    ),
    "Full card contents unavailable",
  );
  await cdp.value("document.querySelector('.luminous-card-expand').click()");
  await fits("overview");
  await cdp.call("Emulation.setDeviceMetricsOverride", {
    width: 2048,
    height: 600,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.value("window.scrollTo(0,1000)");
  await waitUntil(
    cdp,
    "document.querySelector('.luminous-earth canvas').dataset.running==='false' && document.querySelector('.luminous-scene-server .luminous-device').dataset.active==='false'",
    4000,
  );
  const offscreenFrame = await cdp.value(
    "Number(document.querySelector('.luminous-earth canvas').dataset.frame)",
  );
  await cdp.value("new Promise(r=>setTimeout(r,180))");
  failGate(
    await cdp.value(
      "Number(document.querySelector('.luminous-earth canvas').dataset.frame) === " +
        offscreenFrame,
    ),
    "Offscreen Earth kept rendering",
  );
  await width(2048);
  await cdp.value("window.scrollTo(0,0)");
  await waitUntil(
    cdp,
    "document.querySelector('.luminous-earth canvas').dataset.running==='true'",
    4000,
  );
  await cdp.call("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "k",
    code: "KeyK",
    modifiers: 4,
    windowsVirtualKeyCode: 75,
  });
  failGate(
    await cdp.value(
      "document.activeElement===document.querySelector('.luminous-search input')",
    ),
    "Search shortcut did not focus the input",
  );
  await cdp.value(`document.querySelector('.luminous-search input').focus()`);
  await cdp.call("Input.insertText", { text: "不存在的节点" });
  await waitUntil(
    cdp,
    "document.querySelectorAll('.server-card').length===0",
    4000,
  );
  await cdp.value(
    `(()=>{const i=document.querySelector('.luminous-search input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'');i.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await waitUntil(
    cdp,
    "document.querySelectorAll('.server-card').length===15",
    4000,
  );
  await cdp.value(
    `document.querySelector('.luminous-status-filters button:nth-child(2)').click()`,
  );
  await waitUntil(
    cdp,
    "document.querySelectorAll('.server-card.is-offline').length===0",
    4000,
  );
  await cdp.value(
    `document.querySelector('.luminous-status-filters button').click()`,
  );
  await waitUntil(
    cdp,
    "!new URLSearchParams(location.search).has('status') && document.querySelectorAll('.luminous-reference-card').length===15",
    4000,
  );
  await cdp.value(
    `(()=>{const s=document.querySelector('[aria-label="光域未来地区筛选"]');s.value='HK';s.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await waitUntil(
    cdp,
    "document.querySelectorAll('.server-card').length>0 && document.querySelectorAll('.server-card').length<15 && new URLSearchParams(location.search).get('region')==='HK'",
    4000,
  );
  await cdp.value(
    `(()=>{const s=document.querySelector('[aria-label="光域未来地区筛选"]');s.value='';s.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await waitUntil(
    cdp,
    "document.querySelectorAll('.server-card').length===15",
    4000,
  );
  await cdp.value(`document.querySelector('.luminous-tools-toggle').click()`);
  failGate(
    await cdp.value(
      "getComputedStyle(document.querySelector('.home-command-area')).display!=='none'",
    ),
    "Luminous lost the original advanced filters",
  );
  await cdp.value(`document.querySelector('.luminous-tools-toggle').click()`);
  for (const w of [2048, 1672, 1440, 1024, 390, 320]) {
    await width(w);
    for (const [label, selector] of [
      ["标准卡片", ".server-card"],
      ["紧凑卡片", ".compact-node-card"],
      ["大卡片", ".server-card"],
      ["列表", ".node-list"],
    ]) {
      await view(label, selector);
      await fits(`${label} ${w}`);
      if (label === "标准卡片" || label === "大卡片")
        failGate(
          await cdp.value(
            "[...document.querySelectorAll('.server-card .metric-detail,.server-card .ping-source-summary>span,.server-card .ping-task-name')].every(e=>e.scrollWidth<=e.clientWidth+1)",
          ),
          "Luminous card text was clipped at " + w,
        );
      if (w === 2048 && label === "紧凑卡片") {
        failGate(
          await cdp.value(
            "getComputedStyle(document.querySelector('.compact-node-gauge-track')).backgroundImage.includes('conic-gradient')",
          ),
          "Compact cards did not render resource rings",
        );
        await shot("matrix");
      }
      if (w === 2048 && label === "大卡片") await shot("large");
      if (w === 2048 && label === "列表") await shot("list");
      if (w === 390 && label === "紧凑卡片") await shot("mobile");
    }
  }
  await width(2048);
  await navigate("/instance/node-1");
  await waitUntil(
    cdp,
    "document.querySelectorAll('.orbital-instance-metrics article').length===4 && document.querySelectorAll('.instance-chart-card .uplot').length===6",
    10000,
  );
  await shot("instance");
  await cdp.value(
    `document.querySelector('.glacier-metric-tabs button:nth-child(3)').click()`,
  );
  await waitUntil(
    cdp,
    "document.querySelector('.instance-chart-card[data-selected=true] .instance-panel-subhead').textContent.includes('磁盘')",
    4000,
  );
  for (const w of [1440, 1024, 390, 320]) {
    await width(w);
    await fits(`instance ${w}`);
    await waitUntil(
      cdp,
      "[...document.querySelectorAll('.instance-chart-card .instance-uplot-wrap')].every(w=>w.querySelector('.uplot')?.getBoundingClientRect().width<=w.clientWidth+1)",
      4000,
    );
  }
  await width(2048);
  await navigate("/instance/node-1?focus=ping");
  await waitUntil(
    cdp,
    "document.querySelector('.orbital-event-timeline')!==null && document.querySelectorAll('.instance-ping-task').length===6",
    10000,
  );
  await shot("ping");
  await cdp.value(
    `document.querySelector('[aria-label="Ping 图表指标"] button:nth-child(2)').click()`,
  );
  await waitUntil(
    cdp,
    "document.querySelector('[aria-label=\"Ping 图表指标\"] button:nth-child(2)').getAttribute('aria-pressed')==='true'",
    4000,
  );
  for (const w of [2048, 1672, 1440, 1024, 390, 320]) {
    await width(w);
    await fits(`Ping ${w}`);
    await waitUntil(
      cdp,
      "document.querySelector('.instance-ping-panel .uplot').getBoundingClientRect().width<=document.querySelector('.instance-ping-panel .instance-uplot-wrap').clientWidth+1",
      4000,
    );
  }
  await width(2048);
  await navigate("/compare");
  await waitUntil(cdp, "document.querySelector('.compare-page')!==null", 8000);
  failGate(
    await cdp.value(
      "document.querySelector('.compare-page').getBoundingClientRect().top>=75",
    ),
    "Compare overlaps the masthead",
  );
  await fits("comparison workspace");
  await navigate("/?view=theme-manage");
  await waitUntil(
    cdp,
    "document.querySelector('input[value=luminous]')!==null",
    8000,
  );
  await cdp.value(`document.querySelector('input[value=luminous]').click()`);
  await cdp.value(
    `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='打开首页预览').click()`,
  );
  await waitUntil(
    cdp,
    "document.querySelector('.studio-home-preview iframe')?.contentDocument?.documentElement?.dataset.themeStyle==='luminous'",
    10000,
  );
  await cdp.value(
    `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='关闭预览').click()`,
  );
  await cdp.value(
    `[...document.querySelectorAll('.aster-studio-savebar button')].find(b=>b.textContent.includes('保存')).click()`,
  );
  await waitUntil(
    cdp,
    "document.querySelector('.aster-studio-state span')?.dataset.dirty==='false'",
    8000,
  );
  await cdp.value(
    `localStorage.removeItem('appearance');localStorage.removeItem('appearance_default');sessionStorage.clear()`,
  );
  await navigate();
  await waitUntil(
    cdp,
    "document.querySelector('.luminous-home-heading')!==null",
    8000,
  );
  for (const [value, label] of [
    ["glacier", "冰川"],
    ["light", "浅色"],
    ["dark", "深色"],
    ["orbital", "星轨"],
    ["luminous", "光域未来"],
  ]) {
    await cdp.value(
      `if(document.querySelector('.floating-controls-trigger').getAttribute('aria-expanded')!=='true') document.querySelector('.floating-controls-trigger').click()`,
    );
    await waitUntil(
      cdp,
      `document.querySelector('button[aria-label="${label}"]')!==null`,
      4000,
    );
    await cdp.value(
      `document.querySelector('button[aria-label="${label}"]').click()`,
    );
    await waitUntil(
      cdp,
      `JSON.parse(localStorage.getItem('appearance'))==='${value}'`,
      4000,
    );
    if (value !== "luminous")
      await waitUntil(
        cdp,
        "document.querySelector('.luminous-sidebar')===null && document.querySelector('.luminous-home-heading')===null",
        4000,
      );
  }
  await enableNetworkCards();
  await navigate();
  await waitUntil(
    cdp,
    "document.querySelector('.luminous-view-switch select')!==null",
    8000,
  );
  await view("标准卡片", ".luminous-reference-card");
  await waitUntil(
    cdp,
    "document.querySelector('.luminous-card-expand')!==null",
    8000,
  );
  await cdp.value("document.querySelector('.luminous-card-expand').click()");
  await waitUntil(
    cdp,
    "document.querySelector('.server-card .carrier-routes')!==null && document.querySelector('.server-card .carrier-speeds')!==null",
    10000,
  );
  for (const w of [1440, 390, 320]) {
    await width(w);
    for (const [label, selector] of [
      ["标准卡片", ".server-card"],
      ["紧凑卡片", ".compact-node-card"],
      ["大卡片", ".server-card"],
    ]) {
      await view(label, selector);
      if (label === "标准卡片")
        await cdp.value(
          "if(document.querySelector('.luminous-card-expand')?.getAttribute('aria-expanded')==='false')document.querySelector('.luminous-card-expand').click()",
        );
      await waitUntil(
        cdp,
        `document.querySelector('${selector} .carrier-routes')!==null && document.querySelector('${selector} .carrier-speeds')!==null`,
        8000,
      );
      await fits(`network cards ${label} ${w}`);
      failGate(
        await cdp.value(
          `(()=>{const card=document.querySelector('${selector}');return [...card.querySelectorAll('.carrier-routes,.carrier-speeds')].every(n=>n.getBoundingClientRect().width<=card.clientWidth+1)})()`,
        ),
        "Luminous network card contents were clipped",
      );
    }
  }
  await width(2048);
  await view("标准卡片", ".server-card");
  const canLoseContext = await cdp.value(
    "!!document.querySelector('.luminous-earth canvas').getContext('webgl').getExtension('WEBGL_lose_context')",
  );
  if (canLoseContext) {
    await cdp.value(
      "document.querySelector('.luminous-earth canvas').getContext('webgl').getExtension('WEBGL_lose_context').loseContext()",
    );
    await waitUntil(
      cdp,
      "document.querySelector('.luminous-earth canvas').dataset.renderer==='fallback' && document.querySelector('.luminous-earth canvas').dataset.running==='false'",
      4000,
    );
    await fits("context-loss fallback");
  }
  await cdp.call("Network.enable");
  await cdp.call("Network.setBlockedURLs", {
    urls: [`${origin}/api/docs-rates`],
  });
  await cdp.value(
    "localStorage.clear();sessionStorage.clear();localStorage.setItem('appearance',JSON.stringify('luminous'))",
  );
  await navigate();
  await waitUntil(
    cdp,
    "document.querySelector('.luminous-hero [aria-label=\"资产统计\"] strong')?.textContent === '—'",
    20000,
  );
  await cdp.call("Network.setBlockedURLs", { urls: [] });
  const noWebglScript = await cdp.call(
    "Page.addScriptToEvaluateOnNewDocument",
    {
      source:
        "const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){return kind==='webgl'?null:original.call(this,kind,...args)}",
    },
  );
  await navigate();
  await waitUntil(
    cdp,
    "document.querySelector('.luminous-earth canvas')?.dataset.renderer==='fallback' && document.querySelectorAll('.server-card').length===15",
    10000,
  );
  await fits("WebGL fallback");
  await cdp.call("Page.removeScriptToEvaluateOnNewDocument", {
    identifier: noWebglScript.identifier,
  });
  return {
    luminous:
      "independent light palette, animated WebGL Earth/3D devices, pause/offscreen/reduced-motion/context-loss/WebGL fallback, four full card views, six plots, real Ping timeline, Studio persistence/preview, 320–2048px, all network modules, original themes and unavailable-rate fallback",
  };
}
