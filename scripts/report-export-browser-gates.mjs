import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

export async function checkReportExports({ cdp, model, profile, backend, waitUntil, failGate }) {
  const tree = await cdp.call("Page.getFrameTree");
  const targets = await cdp.call("Target.getTargets");
  const target = targets.targetInfos.find(target => target.type === "iframe" && target.url === "about:srcdoc");
  let sessionId;
  if (target) { sessionId = (await cdp.call("Target.attachToTarget", { targetId: target.targetId, flatten: true })).sessionId; await cdp.call("Runtime.enable", {}, sessionId); }
  const child = tree.frameTree.childFrames?.find(frame => frame.frame.url === "about:srcdoc");
  const context = [...cdp.contexts.values()].find(context => context.auxData?.isDefault && (sessionId ? context.sessionId === sessionId : context.auxData?.frameId === child?.frame.id));
  failGate(Boolean(context), "Report execution context missing");
  const childCdp = { value: expression => cdp.value(expression, context.id, sessionId) };
  failGate(model.fullResults.length >= 4 && model.fullResults.every(result => result.url.startsWith("https://")), "Full report links/history were omitted");
  await childCdp.value("document.querySelector('[data-chapter=sources]').click()");
  await waitUntil(childCdp, "document.querySelectorAll('.full-result-image').length>=2 && document.querySelector('[data-results-status]').textContent.includes('已准备')", 12000);
  failGate(await childCdp.value("[...document.querySelectorAll('.full-result-image')].every(image=>image.src.startsWith('data:image/png;base64,')) && document.querySelectorAll('[data-result-list] a').length===4"), "Results need embedded PNG images and a link per run");
  await childCdp.value("document.querySelector('.full-result-image').click()");
  failGate(await childCdp.value("document.querySelector('.report-image-modal').open"), "HD image preview did not open");
  await childCdp.value("document.querySelector('.report-image-modal').close()");
  await childCdp.value("(()=>{const s=document.querySelector('[data-result-style]');s.value='original';s.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-results-preview]').click()})()");
  await waitUntil(childCdp, "document.querySelectorAll('.full-result-image').length===2 && [...document.querySelectorAll('[data-result-figure]')].every(f=>f.dataset.mode==='original') && document.querySelector('[data-results-status]').textContent.includes('已准备')", 15000);
  failGate(await childCdp.value("(async()=>{const image=document.querySelector('[data-result-figure*=nodequality] img'),canvas=document.createElement('canvas');image.loading='eager';await image.decode();canvas.width=canvas.height=1;canvas.getContext('2d').drawImage(image,0,0);const color=canvas.getContext('2d').getImageData(0,0,1,1).data;return color[0]<30&&color[1]<30&&color[2]<40})()"), "Original page background was not preserved");
  failGate(await childCdp.value("(async()=>{const image=document.querySelector('[data-result-figure*=tcpquality] img'),canvas=document.createElement('canvas');image.loading='eager';await image.decode();canvas.width=canvas.height=1;canvas.getContext('2d').drawImage(image,0,image.naturalHeight-1,1,1,0,0,1,1);const color=canvas.getContext('2d').getImageData(0,0,1,1).data;return document.querySelectorAll('[data-result-figure*=tcpquality] img').length===1&&color[0]===31&&color[1]===30&&color[2]===42})()"), "International section must be one intact image with its original background at the bottom");
  await childCdp.value("(()=>{window.__nativePrint=window.print;window.print=()=>window.__printPrepared=true;document.querySelector('.full-result-gallery [data-print]').click()})()");
  await waitUntil(childCdp, "window.__printPrepared===true", 15000);
  failGate(await childCdp.value("document.querySelectorAll('.full-result-image').length===2 && document.querySelectorAll('.report-print-pages img').length>=3"), "Print pagination must not split preview/download images");
  await childCdp.value("window.print=window.__nativePrint");
  await childCdp.value("(()=>{const original=URL.createObjectURL;URL.createObjectURL=blob=>{window.__reportBlob=blob;return original(blob)};const click=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download){window.__reportDownloadName=this.download;return}return click.call(this)}})()");
  await childCdp.value("document.querySelector('[data-results-zip]').click()");
  await waitUntil(childCdp, "window.__reportBlob?.type==='application/zip'", 15000);
  const readBlob = async binary => {
    await childCdp.value(binary ? "window.__reportBlob.arrayBuffer().then(buffer=>{const bytes=new Uint8Array(buffer);let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));window.__reportFile=btoa(text)})" : "window.__reportBlob.text().then(text=>{window.__reportFile=text})");
    const length = await childCdp.value("window.__reportFile.length"); let data = "";
    for (let offset = 0; offset < length; offset += 131072) data += await childCdp.value(`window.__reportFile.slice(${offset},${offset + 131072})`);
    return binary ? Buffer.from(data, "base64") : data;
  };
  const zipPath = join(profile, `results-${backend}.zip`); writeFileSync(zipPath, await readBlob(true));
  const validation = JSON.parse(execFileSync("python3", ["-c", "import sys,zipfile,json,struct\nwith zipfile.ZipFile(sys.argv[1]) as z:\n assert z.testzip() is None\n images=[n for n in z.namelist() if n.endswith('.png')]\n assert len(images)==2\n for n in images:\n  data=z.read(n);assert data[:8]==b'\\x89PNG\\r\\n\\x1a\\n';assert struct.unpack('>I',data[16:20])[0]>=2000\n manifest=json.loads(z.read('results.json'));assert manifest['style']=='original';assert len(manifest['results'])==2\n print(json.dumps({'images':len(images),'style':manifest['style']}))", zipPath], { encoding: "utf8" }));
  failGate(validation.images === 2, "ZIP omitted original result pages");
  await childCdp.value("window.__reportBlob=null;document.querySelector('[data-save-html]').click()");
  await waitUntil(childCdp, "window.__reportBlob?.type==='text/html;charset=utf-8'", 15000);
  const originalHtml = await readBlob(false), originalPath = join(profile, `original-results-${backend}.html`);
  writeFileSync(originalPath, originalHtml);
  if (process.env.BROWSER_REPORT_EXPORT_BASE) writeFileSync(`${process.env.BROWSER_REPORT_EXPORT_BASE}-${backend}-original.html`, originalHtml);
  await childCdp.value("(()=>{const s=document.querySelector('[data-result-style]');s.value='unified';s.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-results-clear]').click();document.querySelector('[data-result-list] input[data-result-id*=older]').click();window.__reportBlob=null;document.querySelector('[data-save-html]').click()})()");
  await waitUntil(childCdp, "window.__reportBlob?.type==='text/html;charset=utf-8'", 15000);
  const exported = await readBlob(false), match = exported.match(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/), payload = JSON.parse(match[1]);
  failGate(payload.fullResults.length === model.fullResults.length && payload.selectedResultIds.length === 1 && payload.selectedResultIds[0].includes("older") && payload.resultStyle === "unified", "HTML must retain history while attaching only chosen result images");
  failGate(exported.includes("data:image/png;base64,") && !exported.includes("203.0.113.19") && !exported.includes("8.8.8.8"), "Embedded image HTML omitted images or leaked an address");
  const selectedPath = join(profile, `selected-results-${backend}.html`);
  writeFileSync(selectedPath, exported);
  async function verifyOffline(path, selectedCount) {
    console.log(`  ${backend}: verifying offline report (${selectedCount} selected)`);
    const offlineTarget = (await cdp.call("Target.createTarget", { url: "about:blank" })).targetId;
    try {
    const offlineSession = (await cdp.call("Target.attachToTarget", { targetId: offlineTarget, flatten: true })).sessionId;
    await cdp.call("Page.enable", {}, offlineSession); await cdp.call("Runtime.enable", {}, offlineSession);
    await cdp.call("Network.enable", {}, offlineSession);
    await cdp.call("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, offlineSession);
    // Data-URL long images can otherwise generate multi-megabyte network
    // events. Keep offline emulation without streaming those URLs over CDP.
    await cdp.call("Network.disable", {}, offlineSession);
    await cdp.call("Page.navigate", { url: new URL(`file://${path}`).href }, offlineSession);
    const offlineCdp = { value: expression => cdp.value(expression, undefined, offlineSession) };
    await waitUntil(offlineCdp, "document.readyState==='complete' && document.querySelector('[data-results-count]')?.textContent.includes('已选择')", 15000);
    await offlineCdp.value("document.querySelector('[data-chapter=sources]').click()");
    if (selectedCount) {
      await offlineCdp.value("document.querySelectorAll('.full-result-image').forEach(image=>image.loading='eager')");
      await waitUntil(offlineCdp, "[...document.querySelectorAll('.full-result-image')].length>0 && [...document.querySelectorAll('.full-result-image')].every(image=>image.complete&&image.naturalWidth>=2400)", 5000);
      await offlineCdp.value("document.querySelector('.full-result-image').click()");
      failGate(await offlineCdp.value("document.querySelector('.report-image-modal')?.open"), "Offline result image must remain interactive");
    } else failGate(await offlineCdp.value("document.querySelectorAll('.full-result-image').length===0"), "Cleared image selection must omit image attachments");
    failGate(await offlineCdp.value(`document.querySelectorAll('[data-result-list] input').length===${model.fullResults.length} && document.querySelectorAll('[data-result-list] input:checked').length===${selectedCount} && !document.querySelector('[data-result-list]').textContent.includes('没有匹配')`), "Offline HTML must retain complete detection history independently of image selection");
    if (selectedCount === 2 && process.env.BROWSER_REPORT_PRINT_PDF) {
      console.log(`  ${backend}: preparing original report PDF`);
      await offlineCdp.value("document.querySelector('.report-image-modal')?.close();window.print=()=>window.__printPrepared=true;document.querySelector('.full-result-gallery [data-print]').click()");
      await waitUntil(offlineCdp, "window.__printPrepared===true", 15000);
      await cdp.call("Emulation.setEmulatedMedia", { media: "print" }, offlineSession);
      const pdf = await cdp.call("Page.printToPDF", { printBackground: true, preferCSSPageSize: true, transferMode: "ReturnAsStream" }, offlineSession);
      const chunks = [];
      try { while (true) { const part = await cdp.call("IO.read", {handle:pdf.stream,size:131072}, offlineSession); chunks.push(Buffer.from(part.data,part.base64Encoded?"base64":"utf8")); if(part.eof)break; } }
      finally { await cdp.call("IO.close", {handle:pdf.stream}, offlineSession); }
      writeFileSync(`${process.env.BROWSER_REPORT_PRINT_PDF}-${backend}-original.pdf`, Buffer.concat(chunks));
      console.log(`  ${backend}: original report PDF saved`);
    }
    } catch (error) { console.error(`Offline report verification failed (${selectedCount} selected):`, error); throw error; }
    finally { await cdp.call("Target.closeTarget", { targetId: offlineTarget }).catch(error => console.warn(`Could not close offline report target: ${error.message}`)); }
  }
  await verifyOffline(selectedPath, 1);
  await verifyOffline(originalPath, 2);
  if (process.env.BROWSER_REPORT_EXPORT_BASE) {
    writeFileSync(`${process.env.BROWSER_REPORT_EXPORT_BASE}-${backend}.zip`, readFileSync(zipPath));
    writeFileSync(`${process.env.BROWSER_REPORT_EXPORT_BASE}-${backend}.html`, exported);
  }
  // Empty image selection and an unmatched search must not erase offline history.
  await childCdp.value("(()=>{document.querySelector('[data-results-clear]').click();const search=document.querySelector('[data-result-search]');search.value='no-match-archive-regression';search.dispatchEvent(new Event('input',{bubbles:true}));window.__reportBlob=null;document.querySelector('[data-save-html]').click()})()");
  await waitUntil(childCdp, "window.__reportBlob?.type==='text/html;charset=utf-8'", 10000);
  const withoutImages = await readBlob(false), emptyArchive = JSON.parse(withoutImages.match(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  failGate(emptyArchive.fullResults.length === model.fullResults.length && emptyArchive.selectedResultIds.length === 0 && !withoutImages.includes('value="no-match-archive-regression"'), "Empty image selection or search erased exported detection history");
  const emptyPath = join(profile, `without-images-${backend}.html`); writeFileSync(emptyPath, withoutImages);
  await verifyOffline(emptyPath, 0);
  await childCdp.value("(()=>{const search=document.querySelector('[data-result-search]');search.value='';search.dispatchEvent(new Event('input',{bubbles:true}))})()");
  // Restore the latest two runs for the regular report/PDF regression.
  await childCdp.value("document.querySelector('[data-results-latest]').click();document.querySelector('[data-results-preview]').click()");
  await waitUntil(childCdp, "document.querySelector('[data-results-status]').textContent.includes('已准备')", 12000);
}
