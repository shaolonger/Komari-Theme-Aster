import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export async function checkGlacier({
  cdp,
  origin,
  waitUntil,
  failGate,
  captureScreenshot,
}) {
  const shotBase = process.env.BROWSER_GLACIER_SCREENSHOT_BASE;
  const shot = async (name) => {
    if (shotBase) {
      const path = `${shotBase}-${name}.png`;
      mkdirSync(dirname(path), { recursive: true });
      await cdp.value("window.scrollTo(0,0)");
      await captureScreenshot(cdp, path);
    }
  };
  const navigate = async (path = "/") => {
    await cdp.call("Page.navigate", { url: origin + path });
    await waitUntil(cdp, "document.querySelector('.app-shell') !== null", 8000);
  };
  const width = async (w) => {
    await cdp.call("Emulation.setDeviceMetricsOverride", {
      width: w,
      height: 941,
      deviceScaleFactor: 1,
      mobile: w < 720,
    });
    await cdp.value(
      "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
    );
  };
  const fits = async (label) =>
    failGate(
      await cdp.value("document.documentElement.scrollWidth <= innerWidth+1"),
      `Glacier ${label} overflows`,
    );
  const view = async (label, selector) => {
    await cdp.value(
      `document.querySelector('.glacier-view-switch [aria-label="${label}"]').click()`,
    );
    await waitUntil(
      cdp,
      `document.querySelector('${selector}') !== null`,
      5000,
    );
  };
  await width(1672);
  await navigate();
  await cdp.value(
    `localStorage.clear();sessionStorage.clear();localStorage.setItem('appearance',JSON.stringify('glacier'))`,
  );
  await cdp.call("Page.reload");
  await waitUntil(
    cdp,
    "document.querySelectorAll('.glacier-list-row').length === 8 && document.querySelector('.glacier-fleet-chart path') !== null",
    10000,
  );
  failGate(
    await cdp.value(
      "document.documentElement.dataset.themeStyle==='glacier' && document.documentElement.dataset.appearance==='light' && document.querySelector('meta[name=theme-color]').content==='#dcecff'",
    ),
    "Glacier did not restore its palette",
  );
  await shot("overview");
  await fits("overview");
  await cdp.value(`document.querySelector('.glacier-list-expand').click()`);
  await waitUntil(
    cdp,
    "document.querySelector('.glacier-list-expanded .server-card') !== null",
    5000,
  );
  failGate(
    await cdp.value(
      "document.querySelector('.glacier-list-expanded').textContent.includes('流量')",
    ),
    "Expanded list lost full card contents",
  );
  await cdp.value(`document.querySelector('.glacier-list-expand').click()`);
  await cdp.value(
    `document.querySelector('.glacier-search input').value='';document.querySelector('.glacier-search input').focus()`,
  );
  await cdp.call("Input.insertText", { text: "不存在的节点" });
  await waitUntil(
    cdp,
    "document.querySelectorAll('.glacier-list-row').length===0",
    4000,
  );
  await cdp.value(
    `(()=>{const input=document.querySelector('.glacier-search input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'');input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await waitUntil(
    cdp,
    "document.querySelectorAll('.glacier-list-row').length===8",
    4000,
  );
  await cdp.value(
    `document.querySelector('.glacier-segments button:nth-child(2)').click()`,
  );
  await waitUntil(
    cdp,
    "[...document.querySelectorAll('.glacier-list-item')].every(n=>n.dataset.state!=='离线')",
    4000,
  );
  await cdp.value(`document.querySelector('.glacier-segments button').click()`);
  for (const w of [1672, 1024, 390, 320]) {
    await width(w);
    for (const [label, selector] of [
      ["紧凑卡片", ".compact-node-card"],
      ["标准卡片", ".server-card"],
      ["大卡片", ".server-card"],
      ["列表", ".glacier-list"],
    ]) {
      await view(label, selector);
      await fits(`${label} ${w}`);
      if (w === 1672 && label === "紧凑卡片") await shot("compact");
      if (w === 1672 && label === "大卡片") await shot("large");
      if (w === 390 && label === "紧凑卡片") await shot("mobile");
    }
  }
  await width(1672);
  await navigate("/instance/node-1");
  await waitUntil(
    cdp,
    "document.querySelectorAll('.glacier-metric-tabs button').length===6",
    10000,
  );
  await waitUntil(
    cdp,
    "document.querySelector('.instance-chart-card:not([hidden]) .uplot') !== null",
    6000,
  );
  failGate(await cdp.value("document.querySelector('.instance-chart-workspace').getBoundingClientRect().height < 600"), "Glacier instance chart retained a large empty stage");
  await shot("instance");
  for (let i = 1; i <= 6; i++) {
    await cdp.value(
      `document.querySelector('.glacier-metric-tabs button:nth-child(${i})').click()`,
    );
    failGate(
      await cdp.value(
        "document.querySelectorAll('.instance-chart-card:not([hidden])').length===1",
      ),
      "Metric selection did not isolate its plot",
    );
  }
  for (const w of [1024, 390, 320]) {
    await width(w);
    await fits(`instance ${w}`);
    await waitUntil(
      cdp,
      "[...document.querySelectorAll('.instance-chart-card:not([hidden]) .instance-uplot-wrap')].every(w=>w.querySelector('.uplot')?.getBoundingClientRect().width<=w.clientWidth+1)",
      4000,
    );
  }
  await width(1672);
  await navigate("/instance/node-1?focus=ping");
  await waitUntil(
    cdp,
    "document.querySelector('.glacier-ping-summary-slot .instance-ping-summary') !== null && document.querySelector('.glacier-ping-legend') !== null",
    10000,
  );
  await shot("ping");
  for (const w of [1672, 1024, 390, 320]) {
    await width(w);
    await fits(`Ping ${w}`);
    await waitUntil(
      cdp,
      "document.querySelector('.instance-ping-panel .uplot').getBoundingClientRect().width <= document.querySelector('.instance-ping-panel .instance-uplot-wrap').clientWidth+1",
      4000,
    );
  }
  await width(1672);
  await navigate("/?view=theme-manage");
  await waitUntil(
    cdp,
    "document.querySelector('.studio-visual-options input[value=glacier]') !== null",
    8000,
  );
  await cdp.value(
    `document.querySelector('.studio-visual-options input[value=glacier]').click()`,
  );
  await cdp.value(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='打开首页预览').click()`,
  );
  await waitUntil(
    cdp,
    "document.querySelector('.studio-home-preview iframe')?.contentDocument?.documentElement?.dataset.themeStyle === 'glacier'",
    8000,
  );
  await cdp.value(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='关闭预览').click()`,
  );
  await cdp.value(
    `Array.from(document.querySelectorAll('.aster-studio-savebar button')).find(b=>b.textContent.includes('保存')).click()`,
  );
  await waitUntil(
    cdp,
    "document.querySelector('.aster-studio-state span')?.dataset.dirty==='false'",
    8000,
  );
  await cdp.value(
    `localStorage.removeItem('appearance');localStorage.removeItem('appearance_default')`,
  );
  await navigate();
  await waitUntil(
    cdp,
    "document.querySelector('.glacier-home-header') !== null",
    8000,
  );
  for (const [value, label] of [
    ["light", "浅色"],
    ["dark", "深色"],
    ["glacier", "冰川"],
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
    if (value !== "glacier")
      failGate(
        await cdp.value(
          "document.querySelector('.glacier-sidebar')===null && document.querySelector('.glacier-home-header')===null",
        ),
        "Glacier leaked into the original appearances",
      );
  }
  return {
    glacier:
      "independent/default appearance, Studio save and preview, four views with full card expansion, search/status, six performance metrics, Ping inspector, 320–1672px, original appearances",
  };
}
