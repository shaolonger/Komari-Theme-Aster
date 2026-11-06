import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Lazy theme stylesheets stay in the document after a SPA appearance change.
// Exercise that lifetime instead of resetting the styles with Page.navigate.
export async function checkCupertinoStyles({
  cdp,
  origin,
  waitUntil,
  failGate,
  captureScreenshot,
  appearance = "cupertino",
}) {
  const base =
    process.env.BROWSER_CUPERTINO_STYLE_SCREENSHOT_BASE ||
    `/tmp/${appearance}-style`;
  mkdirSync(dirname(base), { recursive: true });
  const width = async (value) => {
    await cdp.call("Emulation.setDeviceMetricsOverride", {
      width: value,
      height: 941,
      deviceScaleFactor: 1,
      mobile: value < 721,
    });
    await cdp.value(
      "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
    );
  };
  const switchTheme = async (label, style, shell) => {
    const scheme = label === "原生 · 暗色" ? "dark" : "light";
    await cdp.value(
      "if(document.querySelector('.floating-controls-trigger').getAttribute('aria-expanded')!=='true')document.querySelector('.floating-controls-trigger').click()",
    );
    const selector = `[aria-label="外观选择"] button[aria-label="${label}"]`;
    await waitUntil(
      cdp,
      `document.querySelector(${JSON.stringify(selector)})!==null`,
      5000,
    );
    await cdp.value(
      `document.querySelector(${JSON.stringify(selector)}).click()`,
    );
    await waitUntil(
      cdp,
      `document.documentElement?.dataset.themeStyle==='${style}' && document.documentElement?.dataset.appearance==='${scheme}' && document.querySelector('${shell}')!==null`,
      10000,
    );
    await cdp.value(
      "if(document.querySelector('.floating-controls-trigger').getAttribute('aria-expanded')==='true')document.querySelector('.floating-controls-trigger').click()",
    );
  };
  const view = async (type) => {
    await cdp.value(`document.getElementById('instance-view-${type}').click()`);
    await waitUntil(
      cdp,
      type === "load"
        ? "document.querySelector('.instance-chart-card[data-selected=true] .uplot')!==null"
        : "document.querySelector('.luminous-events-grid article')!==null",
      10000,
    );
    await cdp.value(
      "document.fonts.ready.then(()=>new Promise(r=>setTimeout(r,800)))",
    );
    await cdp.value(
      "(()=>{window.scrollTo(0,0);const input=document.querySelector('.cupertino-global-search input');input?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));if(document.activeElement instanceof HTMLElement)document.activeElement.blur()})()",
    );
    await waitUntil(
      cdp,
      "document.querySelector('.cupertino-global-search .node-switch-results')===null",
      3000,
    );
  };
  const loadGeometry = () =>
    cdp.value(`(()=>{
    const metric=document.querySelector('.luminous-current-metric'),plot=metric.parentElement.querySelector('.instance-uplot-wrap'),a=metric.getBoundingClientRect(),b=plot.getBoundingClientRect();
    return {position:getComputedStyle(metric).position,abovePlot:a.bottom<=b.top+1,insideCard:a.left>=metric.parentElement.getBoundingClientRect().left-1&&a.right<=metric.parentElement.getBoundingClientRect().right+1,
      labels:[...metric.querySelectorAll('dt,dd')].map(e=>({text:e.textContent,width:e.clientWidth,scroll:e.scrollWidth,height:e.getBoundingClientRect().height,lineHeight:parseFloat(getComputedStyle(e).lineHeight)}))};
  })()`);
  const eventGeometry = () =>
    cdp.value(`(()=>{
    const overlaps=(a,b)=>a.left<b.right-1&&b.left<a.right-1&&a.top<b.bottom-1&&b.top<a.bottom-1;
    return [...document.querySelectorAll('.luminous-events-grid article')].map(row=>{
      const elements=[...row.children],rects=elements.map(e=>e.getBoundingClientRect()),r=row.getBoundingClientRect();
      return {positions:elements.map(e=>getComputedStyle(e).position),overlap:rects.some((a,i)=>rects.some((b,j)=>i<j&&overlaps(a,b))),inside:rects.every(a=>a.left>=r.left-1&&a.right<=r.right+1&&a.top>=r.top-1&&a.bottom<=r.bottom+1)};
    });
  })()`);
  const searchGeometry = async () => {
    await cdp.value(
      "document.querySelector('.cupertino-global-search input').focus();document.querySelector('.cupertino-global-search input').click()",
    );
    await waitUntil(
      cdp,
      "document.querySelector('.cupertino-global-search .node-switch-results')!==null",
      5000,
    );
    return cdp.value(`(()=>{
      const input=document.querySelector('.cupertino-global-search input'),s=getComputedStyle(input),wrapper=document.querySelector('.cupertino-global-search'),w=getComputedStyle(wrapper),a=input.getBoundingClientRect(),b=wrapper.getBoundingClientRect();
      return {outline:s.outlineStyle,shadow:s.boxShadow,border:parseFloat(s.borderTopWidth),background:s.backgroundColor,inside:a.left>=b.left&&a.right<=b.right&&a.top>=b.top&&a.bottom<=b.bottom,wrapperShadow:w.boxShadow,wrapperBorder:w.borderColor,focus:document.activeElement===input};
    })()`);
  };
  const assertGeometry = (result, label) => {
    failGate(
      result.load.position === "static" &&
        result.load.abovePlot &&
        result.load.insideCard,
      `Cupertino ${label}: performance statistics must stay above the plot: ${JSON.stringify(result.load)}`,
    );
    failGate(
      result.load.labels.every(
        (e) => e.scroll <= e.width + 1 && e.height <= e.lineHeight * 1.5,
      ),
      `Cupertino ${label}: statistic labels wrap vertically`,
    );
    failGate(
      result.events.length > 0 &&
        result.events.every(
          (e) =>
            !e.overlap && e.inside && e.positions.every((p) => p === "static"),
        ),
      `Cupertino ${label}: anomaly columns overlap: ${JSON.stringify(result.events)}`,
    );
    failGate(
      result.search.focus &&
        result.search.outline === "none" &&
        result.search.shadow === "none" &&
        result.search.border === 0 &&
        result.search.background === "rgba(0, 0, 0, 0)" &&
        result.search.inside,
      `Cupertino ${label}: nested search focus frame: ${JSON.stringify(result.search)}`,
    );
    failGate(
      result.search.wrapperShadow === "none" ||
        result.search.wrapperShadow.includes("inset"),
      `Cupertino ${label}: search focus shadow expands outside its frame`,
    );
  };
  const results = [];
  for (const order of ["cupertino-first", "luminous-first"]) {
    await width(1672);
    await cdp.value(
      `localStorage.setItem('appearance',JSON.stringify('${order === "cupertino-first" ? appearance : "luminous"}'))`,
    );
    await cdp.call("Page.navigate", { url: origin + "/instance/node-0" });
    await waitUntil(
      cdp,
      `document.querySelector('${order === "cupertino-first" ? ".cupertino-sidebar" : ".luminous-sidebar"}')!==null`,
      10000,
    );
    if (order === "cupertino-first")
      await switchTheme("光域未来", "luminous", ".luminous-sidebar");
    await switchTheme(appearance === "cupertino-dark" ? "原生 · 暗色" : "原生 · Cupertino", "cupertino", ".cupertino-sidebar");
    // Switch the native palette in the same document: the family and shell do
    // not change, but cached canvas options and every surface must update.
    await switchTheme(appearance === "cupertino-dark" ? "原生 · Cupertino" : "原生 · 暗色", "cupertino", ".cupertino-sidebar");
    await switchTheme(appearance === "cupertino-dark" ? "原生 · 暗色" : "原生 · Cupertino", "cupertino", ".cupertino-sidebar");
    failGate(await cdp.value(`getComputedStyle(document.documentElement).getPropertyValue('--surface').trim()==='${appearance === "cupertino-dark" ? "#232326" : "#fff"}'`), "Native palette retained the previous color scheme after a SPA switch");
    // Both styles must still be loaded; a reload here would hide the regression.
    failGate(
      await cdp.value(
        "[...document.styleSheets].filter(s=>s.href?.startsWith(location.origin)).some(s=>[...s.cssRules].some(r=>r.cssText.includes('luminous-current-metric')&&r.cssText.includes('position: absolute')))",
      ),
      "Luminous reference stylesheet was not loaded",
    );
    for (const w of [1920, 1672, 1280, 1024, 390, 320]) {
      await width(w);
      await view("load");
      const load = await loadGeometry();
      if (w === 1672)
        await captureScreenshot(cdp, base + "-" + order + "-load.png");
      await view("ping");
      const events = await eventGeometry();
      if (w === 1672 || w === 390)
        await captureScreenshot(
          cdp,
          base + "-" + order + "-ping-" + w + ".png",
        );
      const search = await searchGeometry();
      if (w === 1672)
        await captureScreenshot(cdp, base + "-" + order + "-search.png");
      const result = { order, width: w, load, events, search };
      results.push(result);
      assertGeometry(result, order + " " + w);
      await cdp.value(
        "document.querySelector('.cupertino-global-search input').blur()",
      );
    }
  }
  return {
    themeStyles:
      "native light/dark SPA palette switches and both luminous stylesheet load orders; metric rows, separate event columns and single search focus at 320–1920px",
    cases: results.length,
  };
}
