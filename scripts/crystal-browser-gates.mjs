import { writeFileSync } from "node:fs";

export async function checkCrystal({ cdp, origin, waitUntil, failGate, setFixture }) {
  const card = '.crystal-card[data-node="node-0"]';
  const metric = (width, height = 900) =>
    cdp.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 721 });
  const exists = selector => `document.querySelector(${JSON.stringify(selector)})!==null`;
  const waitFor = selector => waitUntil(cdp, exists(selector), 8000);
  const click = selector => cdp.value(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const view = mode => `.home-node-results[data-view-mode="${mode}"]`;
  const chooseTheme = async (scheme, label) => {
    if (!await cdp.value(exists('.floating-controls button[aria-label="晶透 · 亮色"]'))) {
      await click(".floating-controls-trigger");
    }
    const selector = `.floating-controls button[aria-label="晶透 · ${label}"]`;
    await waitFor(selector);
    await click(selector);
    await waitUntil(cdp, `document.documentElement.dataset.themeStyle==='crystal-${scheme}'`, 6000);
    await click(".floating-controls-trigger");
  };

  await metric(1086, 1448);
  await cdp.call("Page.navigate", { url: origin });
  await waitFor(".app-shell");
  await cdp.value("localStorage.clear(); sessionStorage.clear()");
  await cdp.call("Page.reload");
  await waitUntil(cdp, "document.documentElement.dataset.themeStyle==='crystal-light'", 8000);
  await waitFor(`${card} .crystal-speed-value:enabled`);
  await waitFor(`${card} [data-family="6"] a.crystal-quality`);
  for (const [scheme, label] of [["light", "亮色"], ["dark", "暗色"]]) {
    if (scheme === "dark") await chooseTheme(scheme, label);
    failGate(await cdp.value(`(()=>{
      const card=document.querySelector(${JSON.stringify(card)});
      const rows=[...card.querySelectorAll('.crystal-network-row')];
      return document.documentElement.dataset.appearance===${JSON.stringify(scheme)} &&
        document.documentElement.dataset.themeStyle==='crystal-${scheme}' &&
        document.documentElement.style.colorScheme===${JSON.stringify(scheme)} &&
        document.querySelector('.cupertino-sidebar')===null &&
        document.querySelectorAll('.cupertino-overview-card').length===4 &&
        document.querySelector('.cupertino-home-search input')!==null &&
        rows.map(row=>row.firstElementChild.textContent).join('|')==='电信 IPv4|电信 IPv6|联通 IPv4|联通 IPv6|移动 IPv4|移动 IPv6' &&
        rows.every(row=>row.children.length===4 && row.querySelectorAll('.crystal-history i').length===18) &&
        card.querySelector('.crystal-location,.crystal-favorite')===null &&
        card.querySelector('.crystal-flag img[alt="地区旗帜: US"]') &&
        getComputedStyle(document.documentElement).getPropertyValue('--bg-0').trim()===${JSON.stringify(scheme === "light" ? "#edf3fc" : "#0b111c")} &&
        [...card.querySelectorAll('.crystal-route-label')].every(label=>label.scrollWidth<=label.clientWidth+1) &&
        ['PPFlight-Global','在线 1天22小时','8.3%','30.9%','23.2%','60%','1049','155.86','59.8','107.7'].every(value=>card.textContent.includes(value)) &&
        card.querySelectorAll('.crystal-quota-track [data-filled="true"]').length===21 &&
        card.querySelectorAll('.crystal-quota-track i').length===35;
    })()`), "Crystal reference card is missing live data, aligned network rows, or the selected palette");
    if (process.env.BROWSER_CRYSTAL_SCREENSHOT_BASE) {
      const clip = await cdp.value(`document.fonts.ready.then(()=>{
        const rect=document.querySelector(${JSON.stringify(card)}).getBoundingClientRect();
        const y=Math.max(0,Math.round(rect.top+scrollY-22));
        const style=document.createElement('style');
        style.id='crystal-crop';
        style.textContent='body{min-height:'+(y+1448)+'px}.cupertino-home,.cupertino-masthead,.floating-controls,.site-footer{visibility:hidden}';
        document.head.append(style);
        return {x:0,y,width:1086,height:1448,scale:1};
      })`);
      const screenshot = await cdp.call("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: true });
      writeFileSync(`${process.env.BROWSER_CRYSTAL_SCREENSHOT_BASE}-${scheme}.png`, Buffer.from(screenshot.data, "base64"));
      await cdp.value("document.querySelector('#crystal-crop').remove()");
    }
  }

  for (const [selector, detail] of [
    ['.crystal-route-value[data-direction="forward"]:enabled', "电信 IPv4 去程"],
    ['.crystal-speed-value[data-direction="download"]:enabled', "三网测速 · 北京 · IPv4"],
  ]) {
    await click(`${card} ${selector}`);
    await waitUntil(cdp, `document.querySelector('.network-drawer')?.textContent.includes(${JSON.stringify(detail)})===true`, 6000);
    await click('.network-drawer button[aria-label="关闭面板"]');
  }
  await click(`${card} .dense-node-actions summary`);
  failGate(await cdp.value(`(()=>{
    const menu = document.querySelector(${JSON.stringify(`${card} .dense-node-menu`)});
    return ['节点详情','网络监控','生成报告','复制 IPv4','复制 IPv6'].every(label=>menu.textContent.includes(label));
  })()`), "Crystal overflow menu lost Dense node actions");
  await click(`${card} .dense-node-actions summary`);

  setFixture({ nodes: 4, crystalControls: true });
  await cdp.call("Page.reload");
  await waitFor(`${card} .crystal-network-controls .aurora-check button`);
  await click(`${card} .dense-node-actions summary`);
  await click(`${card} .dense-node-menu button[aria-pressed="false"]`);
  await click(`${card} .dense-node-actions summary`);
  await click(".cupertino-status-filters button:last-child");
  await waitUntil(cdp, "document.querySelectorAll('.crystal-card[data-node]').length===1", 6000);
  await click(".cupertino-status-filters button:first-child");
  await waitUntil(cdp, "document.querySelectorAll('.crystal-card[data-node]').length===4", 6000);
  await cdp.value(`(()=>{
    const select=document.querySelector(${JSON.stringify(`${card} .aurora-city select`)});
    select.value='上海'; select.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await waitUntil(cdp, `document.querySelector(${JSON.stringify(`${card} .crystal-speed-value`)}).textContent.trim()==='0.0'`, 6000);
  failGate(await cdp.value(`document.querySelectorAll(${JSON.stringify(`${card} .crystal-network-controls .aurora-check button`)}).length===2`), "Crystal card is missing authorized quick checks");

  const layouts = [];
  for (const [scheme, label] of [["dark", "暗色"], ["light", "亮色"]]) {
    if (scheme === "light") await chooseTheme(scheme, label);
    for (const width of [1440, 768, 390, 320]) {
      await metric(width);
      await cdp.value("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      for (const mode of ["compact", "standard"]) {
        const text = mode === "compact" ? "紧凑" : "标准";
        await cdp.value(`[...document.querySelectorAll('.cupertino-view-switch button')].find(b=>b.textContent.trim()==='${text}').click()`);
        await waitFor(view(mode));
        const geometry = await cdp.value(`(()=>{
          const card=document.querySelector(${JSON.stringify(card)}), bounds=card.getBoundingClientRect();
          const cells=[...card.querySelectorAll('.crystal-network-row > *, .crystal-resource-value')];
          const controls=[...card.querySelectorAll('.crystal-network-controls .aurora-city,.crystal-network-controls .aurora-check > button')].map(el=>el.getBoundingClientRect());
          const header=[...card.querySelector('.crystal-header').children].map(el=>el.getBoundingClientRect());
          return {
            width: innerWidth, card: Math.round(bounds.width),
            aligned: cells.every(cell=>cell.getBoundingClientRect().right<=bounds.right && cell.scrollWidth<=cell.clientWidth+1),
            overflow: document.documentElement.scrollWidth>innerWidth,
            equalControls: controls.length===3 && controls.every(el=>el.height>=26 && Math.abs(el.height-controls[0].height)<.5 && Math.abs(el.y-controls[0].y)<.5),
            singleHeader: header.length===5 && header.every(el=>Math.abs(el.y+el.height/2-header[0].y-header[0].height/2)<1 && el.right<=bounds.right),
            standard: card.textContent.includes('最近测速') && !!card.querySelector('.crystal-tags'),
          };
        })()`);
        failGate(geometry.aligned && !geometry.overflow && geometry.equalControls && geometry.singleHeader && geometry.standard === (mode === "standard"),
          `Crystal ${scheme} ${mode} layout at ${width}px: ${JSON.stringify(geometry)}`);
        layouts.push({ scheme, mode, ...geometry });
      }
      if (width === 390 && process.env.BROWSER_CRYSTAL_SCREENSHOT_BASE) {
        await cdp.value(`document.querySelector(${JSON.stringify(card)}).scrollIntoView({block:'center'})`);
        const screenshot = await cdp.call("Page.captureScreenshot", { format: "png" });
        writeFileSync(`${process.env.BROWSER_CRYSTAL_SCREENSHOT_BASE}-${scheme}-mobile.png`, Buffer.from(screenshot.data, "base64"));
      }
    }
  }

  setFixture({
    auroraOffline: true,
    auroraSpeedFamilies: ["6"],
    auroraRouteFamilies: ["4"],
    crystalPingBindings: { 1: ["node-0", "node-3"], 2: ["node-3"], 3: ["node-3"], 4: ["node-1"], 7: ["node-1"], 8: ["node-1"] },
  });
  await cdp.call("Page.reload");
  await waitFor(`${card} .crystal-status[data-online="false"]`);
  await waitFor(view("standard"));
  await waitFor(`${card} .crystal-route-value:enabled`);
  await waitFor('.crystal-card[data-node="node-1"] [data-carrier="内网"] .crystal-quality');
  await waitFor('.crystal-card[data-node="node-1"] [data-family="6"] .crystal-speed-value:enabled');
  await waitFor('.crystal-card[data-node="node-3"] .crystal-quality');
  await click(`${card} .dense-node-actions summary`);
  failGate(await cdp.value(`(()=>{
    const nodes=[0,1,2,3].map(index=>document.querySelector('.crystal-card[data-node="node-'+index+'"]'));
    const labels=node=>[...node.querySelectorAll('.crystal-network-name')].map(label=>label.textContent).join('|');
    const privateRow=nodes[1].querySelector('[data-carrier="内网"]');
    return labels(nodes[0])==='电信 IPv4' &&
      labels(nodes[1])==='电信 IPv6|内网 IPv4' &&
      labels(nodes[2])==='' &&
      labels(nodes[3])==='电信 IPv4|联通 IPv4|移动 IPv4' &&
      nodes[0].querySelector('.dense-node-menu button[aria-pressed="true"]') &&
      !nodes[0].querySelector('.crystal-speed-value:enabled') &&
      !nodes[1].querySelector('.crystal-route-value:enabled') &&
      privateRow.querySelectorAll('[data-tone="empty"]').length===18 &&
      new URL(privateRow.querySelector('a.crystal-quality').href).searchParams.get('pingTasks')==='7' &&
      nodes[1].querySelector('.aurora-extra a').textContent.includes('机房网关') &&
      !nodes[2].querySelector('.aurora-extra');
  })()`), "Crystal cards show unbound Ping tasks or hide a valid binding with no samples");
  setFixture({ auroraHidden: true });
  await cdp.call("Page.reload");
  await waitFor(`${card} a.crystal-quality`);
  await waitUntil(cdp, `document.querySelectorAll(${JSON.stringify(`${card} .crystal-network-row > *`)}).length===2 &&
    !document.querySelector(${JSON.stringify(`${card} .crystal-route-pair, ${card} .crystal-speed-pair`)})`, 8000);

  await metric(1086);
  await cdp.call("Page.navigate", { url: `${origin}/?view=theme-manage` });
  await waitFor('.studio-visual-choice input[value="crystal-light"]:checked');
  await click('.studio-visual-choice input[value="crystal-dark"]');
  failGate(await cdp.value(exists('.studio-button.is-primary:enabled')), "Crystal default appearance was not editable in Aster Studio");
  await click(".studio-button.is-primary");
  await waitUntil(cdp, "document.querySelector('.studio-button.is-primary')?.disabled===true && document.body.textContent.includes('主题设置已保存')", 8000);
  await cdp.value("localStorage.removeItem('appearance'); localStorage.removeItem('appearance_default')");
  await cdp.call("Page.navigate", { url: origin });
  await waitUntil(cdp, "document.documentElement.dataset.themeStyle==='crystal-dark' && localStorage.getItem('appearance_default')===JSON.stringify('crystal-dark')", 8000);
  await waitFor(card);
  return { crystal: "light and dark palettes, single-row header, equal-height controls, actions, and per-node Ping bindings", layouts };
}
