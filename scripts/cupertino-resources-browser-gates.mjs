export async function checkCupertinoResources({ cdp, waitUntil, failGate, captureScreenshot, base, width }) {
  await cdp.value("[...document.querySelectorAll('.cupertino-view-switch button')].find(b=>b.textContent.trim()==='紧凑').click()");
  await waitUntil(cdp, "document.querySelectorAll('.compact-node-card').length===8 && document.querySelector('.cupertino-resource-value')?.textContent.includes('271/600 GB')", 10000);
  const overviewText = await cdp.value("document.querySelector('.cupertino-overview').textContent");
  failGate(overviewText.includes('7.60 GB') && overviewText.includes('271/600 GB') && overviewText.includes('409 GB') && overviewText.includes('另 2 台不限量'), 'Native fleet resources must include offline memory, use per-node accounting and keep unlimited quota separate: ' + overviewText);
  const summary = () => cdp.value("[...document.querySelectorAll('.cupertino-memory-total,.cupertino-resource-value,.cupertino-unlimited-badge,.cupertino-resource-footer > span:nth-child(2)')].map(e=>e.textContent).join('|')");
  const summaryBefore = await summary();
  await cdp.value("document.querySelector('.cupertino-status-filters button:nth-child(2)').click()");
  await waitUntil(cdp, "document.querySelectorAll('.compact-node-card').length===7 && document.querySelector('.compact-node-tag')!==null", 10000);
  failGate(await summary() === summaryBefore, 'Node filtering changed global resource totals');
  await cdp.value("document.querySelector('.cupertino-status-filters button:first-child').click()");
  await waitUntil(cdp, "document.querySelectorAll('.compact-node-card').length===8 && document.querySelector('.compact-node-tag')!==null", 10000);

  const measurements = [];
  for (const w of [1920, 1440, 1280, 1024, 768, 390, 320]) {
    await width(w);
    // Desktop and mobile intentionally remember separate view preferences.
    await cdp.value("[...document.querySelectorAll('.cupertino-view-switch button')].find(b=>b.textContent.trim()==='紧凑').click()");
    await waitUntil(cdp, "document.querySelectorAll('.compact-node-card').length===8 && document.querySelector('.compact-node-tag')!==null", 10000);
    await cdp.value("document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))");
    const geometry = await cdp.value(`(()=>{
      const cards=[...document.querySelectorAll('.cupertino-overview-card')];
      const inside=(e,root)=>{if(!e.getClientRects().length)return true;const a=e.getBoundingClientRect(),b=root.getBoundingClientRect();return a.left>=b.left-1&&a.right<=b.right+1&&a.top>=b.top-1&&a.bottom<=b.bottom+1&&e.scrollWidth<=e.clientWidth+1&&e.scrollHeight<=e.clientHeight+1};
      const labels=cards.flatMap(card=>[...card.querySelectorAll('.cupertino-stat-content > *, .cupertino-unlimited-badge, .cupertino-resource-footer')].map(e=>({text:e.textContent,inside:inside(e,card)})));
      const tags=[...document.querySelectorAll('.compact-node-subtitle,.compact-node-tag,.compact-node-meta-facts > span')].map(e=>({text:e.textContent,inside:inside(e,e.closest('.compact-node-card'))}));
      const content=document.querySelector('.cupertino-traffic-resources .cupertino-stat-content > :last-child'),footer=document.querySelector('.cupertino-resource-footer');
      return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,columns:cards.map(e=>Math.round(e.getBoundingClientRect().top)),labels,tags,footerSeparated:content.getBoundingClientRect().bottom<=footer.getBoundingClientRect().top+1};
    })()`);
    failGate(!geometry.overflow && geometry.labels.every(e=>e.inside) && geometry.tags.length>0 && geometry.tags.every(e=>e.inside) && geometry.footerSeparated,
      'Native overview or compact metadata clipped at ' + w + ': ' + JSON.stringify(geometry));
    if (w >= 1024) failGate(new Set(geometry.columns).size === 1, 'Desktop overview must remain a single four-card row');
    if ([1920, 390, 320].includes(w)) await captureScreenshot(cdp, base + '-compact-resources-' + w + '.png');
    measurements.push({ width: w, labels: geometry.labels.length, tags: geometry.tags.length });
  }
  await width(1920);
  await cdp.value("document.querySelector('.cupertino-assets').click()");
  await waitUntil(cdp, "document.querySelectorAll('.cost-summary-detail-item').length===8", 10000);
  await cdp.value("[...document.querySelectorAll('.cost-summary-sort-tab')].find(b=>b.textContent==='到期').click()");
  const metricGridFits = () => cdp.value(`(()=>{const grid=document.querySelector('.cost-summary-metric-grid'),r=grid.getBoundingClientRect();return [...grid.querySelectorAll('.cost-summary-metric,.cost-summary-metric strong')].every(e=>{const a=e.getBoundingClientRect();return a.left>=r.left&&a.right<=r.right&&a.top>=r.top&&a.bottom<=r.bottom&&e.scrollWidth<=e.clientWidth+1})})()`);
  failGate(await metricGridFits(), 'Desktop asset summary metrics were compressed or clipped');
  const rowOrder = () => cdp.value("[...document.querySelectorAll('.cost-summary-detail-item')].map(e=>e.dataset.nodeUuid)");
  const ascending = await rowOrder();
  failGate(JSON.stringify(ascending.slice(0, 6)) === JSON.stringify(['node-0','node-1','node-3','node-2','node-4','node-5']), 'Expiry ordering lost free nodes or exact date order: ' + ascending);
  await captureScreenshot(cdp, base + '-assets-expiry.png');
  await cdp.value("document.querySelector('.cost-summary-action.is-direction').click()");
  const descending = await rowOrder();
  failGate(JSON.stringify(descending.slice(0, 6)) === JSON.stringify(ascending.slice(0, 6).reverse()) && descending.slice(6).every(id=>['node-6','node-7'].includes(id)), 'Descending expiry must keep unknown/lifetime entries last');
  for (const w of [390, 320]) {
    await width(w);
    failGate(await metricGridFits(), 'Mobile asset summary metrics clipped at ' + w);
    failGate(await cdp.value(`(()=>{const panel=document.querySelector('.cost-summary-panel'),r=panel.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&[...panel.querySelectorAll('.cost-summary-sort-tab,.cost-summary-action.is-direction')].every(e=>{const a=e.getBoundingClientRect();return a.left>=r.left&&a.right<=r.right&&e.scrollWidth<=e.clientWidth+1})})()`), 'Mobile expiry controls clipped at ' + w);
    await captureScreenshot(cdp, base + '-assets-expiry-' + w + '.png');
  }
  await cdp.value("document.querySelector('.cost-summary-close').click()");
  await width(1672);
  await cdp.value("[...document.querySelectorAll('.cupertino-view-switch button')].find(b=>b.textContent.trim()==='标准').click()");
  return { measurements, ascending, descending };
}
