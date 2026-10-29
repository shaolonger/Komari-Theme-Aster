import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export async function checkOrbital({
  cdp,
  origin,
  waitUntil,
  failGate,
  captureScreenshot,
  enableNetworkCards,
}) {
  const base = process.env.BROWSER_ORBITAL_SCREENSHOT_BASE;
  const shot = async (name) => {
    if (base) {
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
      `Orbital ${label} overflows`,
    );
  const view = async (label, selector) => {
    await cdp.value(
      `document.querySelector('.orbital-view-switch [aria-label="${label}"]').click()`,
    );
    await waitUntil(cdp, `document.querySelector('${selector}')!==null`, 6000);
  };
  await width(2048);
  await navigate();
  await cdp.value(
    `localStorage.clear();sessionStorage.clear();localStorage.setItem('appearance',JSON.stringify('orbital'))`,
  );
  await cdp.call("Page.reload");
  await waitUntil(
    cdp,
    "document.querySelectorAll('.server-card').length===15 && document.querySelector('.orbital-fleet-history path')!==null",
    10000,
  );
  failGate(
    await cdp.value(
      "document.documentElement.dataset.themeStyle==='orbital' && document.documentElement.dataset.appearance==='dark' && document.querySelector('meta[name=theme-color]').content==='#030c16'",
    ),
    "Orbital did not restore its independent dark palette",
  );
  await shot("overview");
  await fits("overview");
  await cdp.value(`document.querySelector('.orbital-search input').focus()`);
  await cdp.call("Input.insertText", { text: "不存在的节点" });
  await waitUntil(
    cdp,
    "document.querySelectorAll('.server-card').length===0",
    4000,
  );
  await cdp.value(
    `(()=>{const i=document.querySelector('.orbital-search input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'');i.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await waitUntil(
    cdp,
    "document.querySelectorAll('.server-card').length===15",
    4000,
  );
  await cdp.value(
    `document.querySelector('.orbital-status-filters button:nth-child(2)').click()`,
  );
  await waitUntil(
    cdp,
    "document.querySelectorAll('.server-card.is-offline').length===0",
    4000,
  );
  await cdp.value(
    `document.querySelector('.orbital-status-filters button').click()`,
  );
  await cdp.value(
    `(()=>{const s=document.querySelector('[aria-label="星轨地区筛选"]');s.value='HK';s.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await waitUntil(
    cdp,
    "document.querySelectorAll('.server-card').length>0 && document.querySelectorAll('.server-card').length<15 && new URLSearchParams(location.search).get('region')==='HK'",
    4000,
  );
  await cdp.value(
    `document.querySelector('.orbital-sidebar-groups a').click()`,
  );
  await waitUntil(
    cdp,
    "document.querySelectorAll('.server-card').length===15",
    4000,
  );
  await cdp.value(`document.querySelector('.orbital-tools-toggle').click()`);
  failGate(
    await cdp.value(
      "getComputedStyle(document.querySelector('.home-command-area')).display!=='none'",
    ),
    "Orbital lost the original advanced filters",
  );
  await cdp.value(`document.querySelector('.orbital-tools-toggle').click()`);
  for (const w of [2048, 1440, 1024, 390, 320]) {
    await width(w);
    for (const [label, selector] of [
      ["标准卡片", ".server-card"],
      ["紧凑卡片", ".compact-node-card"],
      ["大卡片", ".server-card"],
      ["列表", ".node-list"],
    ]) {
      await view(label, selector);
      await fits(`${label} ${w}`);
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
  for (const w of [2048, 1440, 1024, 390, 320]) {
    await width(w);
    await fits(`Ping ${w}`);
    await waitUntil(
      cdp,
      "document.querySelector('.instance-ping-panel .uplot').getBoundingClientRect().width<=document.querySelector('.instance-ping-panel .instance-uplot-wrap').clientWidth+1",
      4000,
    );
  }
  await width(2048);
  await navigate("/?view=theme-manage");
  await waitUntil(
    cdp,
    "document.querySelector('input[value=orbital]')!==null",
    8000,
  );
  await cdp.value(`document.querySelector('input[value=orbital]').click()`);
  await cdp.value(
    `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='打开首页预览').click()`,
  );
  await waitUntil(
    cdp,
    "document.querySelector('.studio-home-preview iframe')?.contentDocument?.documentElement?.dataset.themeStyle==='orbital'",
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
    "document.querySelector('.orbital-home-heading')!==null",
    8000,
  );
  for (const [value, label] of [
    ["glacier", "冰川"],
    ["light", "浅色"],
    ["dark", "深色"],
    ["orbital", "星轨"],
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
    if (value !== "orbital")
      await waitUntil(
        cdp,
        "document.querySelector('.orbital-sidebar')===null && document.querySelector('.orbital-home-heading')===null",
        4000,
      );
  }
  await enableNetworkCards();
  await navigate();
  await waitUntil(cdp, "document.querySelector('.server-card .carrier-routes')!==null && document.querySelector('.server-card .carrier-speeds')!==null", 10000);
  for (const w of [1440, 390, 320]) {
    await width(w);
    for (const [label, selector] of [["标准卡片", ".server-card"], ["紧凑卡片", ".compact-node-card"], ["大卡片", ".server-card"]]) {
      await view(label, selector);
      await waitUntil(cdp, `document.querySelector('${selector} .carrier-routes')!==null && document.querySelector('${selector} .carrier-speeds')!==null`, 8000);
      await fits(`network cards ${label} ${w}`);
      failGate(await cdp.value(`(()=>{const card=document.querySelector('${selector}');return [...card.querySelectorAll('.carrier-routes,.carrier-speeds')].every(n=>n.getBoundingClientRect().width<=card.clientWidth+1)})()`), "Orbital network card contents were clipped");
    }
  }
  await width(2048);
  await view("标准卡片", ".server-card");
  await cdp.call("Network.enable");
  await cdp.call("Network.setBlockedURLs", { urls: [`${origin}/api/docs-rates`] });
  await cdp.value("localStorage.clear();sessionStorage.clear();localStorage.setItem('appearance',JSON.stringify('orbital'))");
  await navigate();
  await waitUntil(cdp, "document.querySelector('.orbital-fleet [aria-label=\"资产统计\"] strong')?.textContent === '—'", 20000);
  await cdp.call("Network.setBlockedURLs", { urls: [] });
  return {
    orbital:
      "independent/default dark palette, real regional map and filters, four complete card views and compact resource rings, six performance plots, Ping routes/timeline, Studio save/isolated preview, 320–2048px, original themes, all route/speed card modules, unavailable-rate fallback",
  };
}
