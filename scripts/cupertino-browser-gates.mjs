import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { checkCupertinoStyles } from "./cupertino-style-browser-gates.mjs";
export async function checkCupertino({
  cdp,
  origin,
  waitUntil,
  failGate,
  captureScreenshot,
  enableNetworkCards,
  appearance = "cupertino",
}) {
  const dark = appearance === "cupertino-dark";
  const base =
    process.env.BROWSER_CUPERTINO_SCREENSHOT_BASE || `/tmp/${appearance}-reference`;
  mkdirSync(dirname(base), { recursive: true });
  await cdp.call("Emulation.setDeviceMetricsOverride", {
    width: 1672,
    height: 941,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.call("Page.navigate", { url: origin });
  await waitUntil(cdp, "document.querySelector('.app-shell')!==null", 10000);
  await cdp.value(
    `localStorage.clear();sessionStorage.clear();localStorage.setItem('appearance',JSON.stringify(${JSON.stringify(appearance)}))`,
  );
  await cdp.call("Page.reload");
  const measurements = {};
  for (const [name, path, ready, selectors] of [
    [
      "home",
      "/",
      "document.querySelectorAll('.cupertino-node-card').length===8",
      [
        ".app-main",
        ".cupertino-home-heading",
        ".cupertino-overview",
        ".cupertino-attention",
        ".cupertino-toolbar",
        ".cupertino-node-card",
      ],
    ],
    [
      "instance",
      "/instance/node-0",
      "document.querySelector('.cupertino-instance-metrics') && document.querySelectorAll('.instance-chart-card .uplot').length>=4",
      [
        ".instance-topbar",
        ".cupertino-instance-metrics",
        ".luminous-instance-navigation",
        ".instance-chart-workspace",
        ".cupertino-detail-aside",
      ],
    ],
    [
      "ping",
      "/instance/node-0?focus=ping",
      "document.querySelectorAll('.instance-ping-task').length===6 && document.querySelector('.luminous-event-cards')!==null",
      [
        ".instance-topbar",
        ".luminous-instance-navigation",
        ".luminous-ping-summary",
        ".instance-ping-diagnostic-controls",
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
      "document.fonts.ready.then(()=>new Promise(r=>setTimeout(r,500)))",
    );
    await cdp.value("window.scrollTo(0,0)");
    await captureScreenshot(cdp, base + "-" + name + ".png");
    if (name === "instance")
      failGate(
        await cdp.value(
          `getComputedStyle(document.querySelector('.cupertino-switch-node')).backgroundColor==='${dark ? "rgb(35, 35, 38)" : "rgb(255, 255, 255)"}'`,
        ),
        "Cupertino switch action must retain its neutral reference surface",
      );
    if (name === "instance")
      failGate(await cdp.value(`(()=>{
        const tile=document.querySelector('[data-metric="uptime"]'),bounds=tile.getBoundingClientRect();
        return [...tile.children].every(child=>{const r=child.getBoundingClientRect();return r.top>=bounds.top && r.bottom<=bounds.bottom;});
      })()`), "Cupertino uptime label or last report time is clipped");
    measurements[name] = await cdp.value(
      `Object.fromEntries(${JSON.stringify(selectors)}.map(s=>{const r=document.querySelector(s)?.getBoundingClientRect();return[s,r?{x:r.x,y:r.y,width:r.width,height:r.height}:null]}))`,
    );
    failGate(
      await cdp.value("document.documentElement.scrollWidth<=innerWidth+1"),
      `Cupertino ${name}: horizontal overflow`,
    );
  }
  const palette = await cdp.value(`(()=>{
    const root=document.documentElement,styles=getComputedStyle(root);
    return {style:root.dataset.themeStyle,appearance:root.dataset.appearance,scheme:styles.colorScheme,
      canvas:styles.getPropertyValue('--bg-0').trim(),surface:styles.getPropertyValue('--surface').trim(),
      accent:styles.getPropertyValue('--accent-500').trim(),text:styles.getPropertyValue('--text-primary').trim()};
  })()`);
  failGate(palette.style==='cupertino' && palette.appearance===(dark?'dark':'light') && palette.scheme===(dark?'dark':'light'), 'Native color scheme did not follow saved appearance');
  failGate(palette.canvas===(dark?'#141416':'#f5f5f7') && palette.surface===(dark?'#232326':'#fff') && palette.accent===(dark?'#0a84ff':'#007aff'), 'Native reference palette drifted: '+JSON.stringify(palette));
  measurements.palette=palette;
  const navigate = async (path = "/") => {
    await cdp.call("Page.navigate", { url: origin + path });
    await waitUntil(
      cdp,
      "document.querySelector('.cupertino-sidebar')!==null",
      10000,
    );
  };
  const settle = async () =>
    cdp.value(
      "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
    );
  const fits = async (label) => {
    await settle();
    failGate(
      await cdp.value("document.documentElement.scrollWidth<=innerWidth+1"),
      "Cupertino overflow: " + label,
    );
  };
  const click = async (selector) => {
    await cdp.value(
      `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'nearest'})`,
    );
    const point = await cdp.value(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return{x,y,hit:e.contains(document.elementFromPoint(x,y))}})()`,
    );
    failGate(point?.hit, "Cupertino control is obscured: " + selector);
    await cdp.call("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 1,
    });
    await cdp.call("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 1,
    });
  };
  const key = async (name, code, modifiers = 0) => {
    await cdp.call("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: name,
      code: name,
      windowsVirtualKeyCode: code,
      modifiers,
    });
    await cdp.call("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: name,
      code: name,
      windowsVirtualKeyCode: code,
      modifiers,
    });
  };
  const width = async (width) => {
    await cdp.call("Emulation.setDeviceMetricsOverride", {
      width,
      height: 941,
      deviceScaleFactor: 1,
      mobile: width < 721,
    });
    await settle();
  };
  failGate(
    Math.abs(measurements.home[".cupertino-node-card"].y - (dark ? 376 : 382)) < 5,
    "Cupertino reference card position drifted",
  );
  failGate(
    measurements.home[".cupertino-node-card"].height < 300,
    "Cupertino reference card density drifted",
  );
  failGate(
    Math.abs(measurements.instance[".cupertino-instance-metrics"].y - (dark ? 207 : 211)) < 5,
    "Cupertino reference metric row drifted",
  );
  failGate(
    measurements.ping[".instance-ping-panel>.instance-uplot-wrap"].y -
      measurements.ping[".instance-ping-diagnostic-controls"].y <
      100,
    "Cupertino Ping chart has a spacer",
  );
  failGate(
    await cdp.value(
      "document.querySelector('.instance-segmented[role=tablist]')?.offsetHeight>0 && document.querySelectorAll('.cupertino-global-search input').length===1 && document.querySelectorAll('.cupertino-current-node').length===1",
    ),
    "Cupertino persistent navigation or unique node search/current card missing",
  );
  await click('[aria-label="Ping 图表指标"] button:nth-child(2)');
  await waitUntil(
    cdp,
    "document.querySelector('.luminous-ping-chart-title strong')?.textContent.includes('丢包')",
    4000,
  );
  await click('[aria-label="Ping 图表指标"] button:first-child');
  await click(".instance-ping-task-row:first-child .instance-ping-watch");
  await waitUntil(
    cdp,
    "document.querySelector('.instance-ping-task-row:first-child .instance-ping-watch')?.getAttribute('aria-pressed')==='true'",
    4000,
  );
  await click(".instance-ping-task-row:first-child .instance-ping-task");
  await waitUntil(
    cdp,
    "document.querySelector('.instance-ping-task-row:first-child .instance-ping-task')?.getAttribute('aria-pressed')==='false'",
    4000,
  );
  await click(".instance-ping-task-row:first-child .instance-ping-task");
  for (const view of ["traffic", "network", "load", "ping", "load"]) {
    await click("#instance-view-" + view);
    await waitUntil(
      cdp,
      `document.querySelector('.cupertino-instance')?.dataset.chart==='${view}'`,
      8000,
    );
    await fits("detail " + view);
    failGate(
      await cdp.value(
        "document.querySelector('.instance-segmented[role=tablist]')?.offsetHeight>0",
      ),
      "Cupertino view switcher vanished in " + view,
    );
  }
  await waitUntil(
    cdp,
    "document.querySelectorAll('.instance-chart-card .uplot').length>=4",
    10000,
  );
  for (let i = 0; i < 6; i++) {
    await click(".glacier-metric-tabs button:nth-child(" + (i + 1) + ")");
    await waitUntil(
      cdp,
      "(document.querySelector('.instance-chart-card[data-selected=true] .uplot')?.getBoundingClientRect().width||0)>600",
      8000,
    );
    failGate(
      await cdp.value(
        "document.querySelector('.instance-chart-card[data-selected=true] .uplot').getBoundingClientRect().width>300",
      ),
      "Cupertino selected chart is too narrow",
    );
  }
  await click(".cupertino-load-settings summary");
  failGate(
    await cdp.value("document.querySelector('.cupertino-load-settings').open"),
    "Cupertino sampling settings inaccessible",
  );
  await click(".cupertino-load-settings summary");
  await click(".cupertino-switch-node");
  await cdp.call("Input.insertText", { text: "hytron-hk.0.74" });
  await key("Enter", 13);
  await waitUntil(cdp, "location.pathname==='/instance/node-1'", 8000);
  await navigate("/instance/node-7");
  await waitUntil(
    cdp,
    "document.querySelector('.cupertino-cache-notice')!==null",
    10000,
  );
  failGate(
    await cdp.value(
      "document.querySelector('.instance-report-entry')?.href.includes('/instance/node-7/report')",
    ),
    "Offline node report entry missing",
  );
  await navigate();
  await waitUntil(
    cdp,
    "document.querySelectorAll('.cupertino-node-card').length===8",
    10000,
  );
  await click(".luminous-search input");
  await cdp.call("Input.insertText", { text: "hkcloudx, hosuyun" });
  await key("Enter", 13);
  await waitUntil(
    cdp,
    "document.querySelectorAll('.home-node-card-slot').length===2",
    4000,
  );
  await fits("multi-node search");
  await key("Escape", 27);
  await click(".luminous-search-clear");
  await waitUntil(
    cdp,
    "document.querySelectorAll('.cupertino-node-card').length===8",
    4000,
  );
  await click(".cupertino-node-card:first-child .cupertino-favorite");
  await click(".cupertino-status-filters button:last-child");
  await waitUntil(
    cdp,
    "document.querySelectorAll('.cupertino-node-card').length===1",
    4000,
  );
  await click(".cupertino-status-filters button:first-child");
  await waitUntil(
    cdp,
    "document.querySelectorAll('.cupertino-node-card').length===8",
    4000,
  );
  await click(".cupertino-node-card:first-child [aria-expanded]");
  await waitUntil(
    cdp,
    "document.querySelector('.cupertino-full-card .server-card')!==null",
    8000,
  );
  await click(".cupertino-node-card:first-child [aria-expanded]");
  await click(".cupertino-online");
  await waitUntil(
    cdp,
    "document.querySelector('.home-overview-panel')!==null",
    8000,
  );
  await key("Escape", 27);
  await waitUntil(
    cdp,
    "document.querySelector('.home-overview-panel')===null",
    4000,
  );
  for (const [label, ready] of [
    [
      "列表",
      "document.querySelectorAll('.node-list-row[role=row]').length===8",
    ],
    ["紧凑", "document.querySelectorAll('.compact-node-card').length===8"],
    [
      "大卡片",
      "document.querySelectorAll('.home-node-card-slot>.server-card').length===8",
    ],
    ["标准", "document.querySelectorAll('.cupertino-node-card').length===8"],
  ]) {
    await cdp.value(
      `[...document.querySelectorAll('.cupertino-view-switch button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`,
    );
    await waitUntil(cdp, ready, 10000);
    await fits(label);
  }
  await click(".cupertino-more-filters");
  await fits("additional filters");
  await click(".cupertino-more-filters");
  for (const w of [1920, 1440, 1024, 768, 390, 320]) {
    await width(w);
    await navigate();
    await waitUntil(
      cdp,
      "document.querySelector('.cupertino-toolbar')!==null",
      10000,
    );
    await fits("home " + w);
    if (w <= 390) {
      await click(".luminous-search input");
      await fits("mobile search panel " + w);
      await key("Escape", 27);
    }
    if (w === 390) {
      await captureScreenshot(cdp, base + "-home-mobile.png");
      await click(".cupertino-mobile-menu");
      failGate(
        await cdp.value(
          "document.querySelector('.cupertino-sidebar').dataset.open==='true'",
        ),
        "Mobile sidebar did not open",
      );
      await key("Escape", 27);
    }
    for (const view of ["load", "ping", "traffic", "network"]) {
      await navigate("/instance/node-0?focus=" + view);
      await waitUntil(
        cdp,
        `document.querySelector('.cupertino-instance')?.dataset.chart==='${view}'`,
        10000,
      );
      await cdp.value("new Promise(r=>setTimeout(r,180))");
      await fits(view + " " + w);
    }
    if (w === 390) {
      await navigate("/instance/node-0");
      await waitUntil(
        cdp,
        "document.querySelector('.cupertino-instance-metrics')!==null",
        10000,
      );
      await captureScreenshot(cdp, base + "-instance-mobile.png");
    }
  }
  await width(1672);
  await navigate("/?view=theme-manage");
  await waitUntil(
    cdp,
    `document.querySelector('input[value="${appearance}"]')!==null`,
    10000,
  );
  await cdp.value(`document.querySelector('input[value="${appearance}"]').click()`);
  await cdp.value(
    "[...document.querySelectorAll('.aster-studio-savebar button')].find(b=>b.textContent.includes('保存')).click()",
  );
  await waitUntil(
    cdp,
    "document.querySelector('.aster-studio-state span')?.dataset.dirty==='false'",
    8000,
  );
  await cdp.value(
    "localStorage.removeItem('appearance');localStorage.removeItem('appearance_default');sessionStorage.clear()",
  );
  await navigate();
  await waitUntil(
    cdp,
    "document.querySelector('.cupertino-home-heading')!==null",
    8000,
  );
  for (const theme of [
    "light",
    "dark",
    "glacier",
    "orbital",
    "luminous",
    "cupertino",
    "cupertino-dark",
  ]) {
    await cdp.value(
      `localStorage.setItem('appearance',JSON.stringify('${theme}'))`,
    );
    await cdp.call("Page.reload");
    await waitUntil(
      cdp,
      `document.documentElement.dataset.themeStyle==='${theme.startsWith("cupertino") ? "cupertino" : theme === "light" || theme === "dark" ? "default" : theme}'`,
      10000,
    );
    if (!theme.startsWith("cupertino"))
      failGate(
        await cdp.value("document.querySelector('.cupertino-sidebar')===null"),
        "Cupertino shell leaked into " + theme,
      );
  }
  const styleIsolation = await checkCupertinoStyles({
    appearance,
    cdp,
    origin,
    waitUntil,
    failGate,
    captureScreenshot,
  });
  await enableNetworkCards();
  await navigate();
  await waitUntil(
    cdp,
    "document.querySelector('.cupertino-toolbar')!==null",
    10000,
  );
  for (const w of [1672, 320]) {
    await width(w);
    for (const [label, selector] of [
      ["标准", ".cupertino-node-card"],
      ["紧凑", ".compact-node-card"],
      ["大卡片", ".home-node-card-slot>.server-card"],
    ]) {
      await cdp.value(
        `[...document.querySelectorAll('.cupertino-view-switch button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`,
      );
      await waitUntil(
        cdp,
        `document.querySelector('${selector} .carrier-routes')!==null && document.querySelector('${selector} .carrier-speeds')!==null`,
        10000,
      );
      await fits("carrier modules " + label + " " + w);
      failGate(
        await cdp.value(
          `(()=>{const card=document.querySelector('${selector}');return [...card.querySelectorAll('.carrier-routes,.carrier-speeds')].every(n=>n.getBoundingClientRect().width<=card.clientWidth+1)})()`,
        ),
        "Cupertino carrier module content clipped",
      );
    }
  }
  writeFileSync(
    base + "-measurements.json",
    JSON.stringify(measurements, null, 2),
  );
  return {
    appearance,
    cupertino:
      "reference geometry, four full views, multi-search, favorites, metrics/settings, carrier modules, persistent tabs, unique search, offline report entry, Studio persistence, original themes, 320–1920px",
    measurements,
    styleIsolation,
  };
}
