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
  await childCdp.value("document.querySelector('[data-chapter=network]').click()");
  await waitUntil(childCdp, "document.querySelectorAll('.full-result-image').length>=2 && document.querySelector('[data-results-status]').textContent.includes('已准备')", 12000);
  failGate(await childCdp.value("[...document.querySelectorAll('.full-result-image')].every(image=>image.src.startsWith('data:image/png;base64,')) && document.querySelectorAll('[data-result-list] a').length===4"), "Results need embedded PNG images and a link per run");
  await childCdp.value("document.querySelector('.full-result-image').click()");
  failGate(await childCdp.value("document.querySelector('.report-image-modal').open"), "HD image preview did not open");
  await childCdp.value("document.querySelector('.report-image-modal').close()");
  await childCdp.value("(()=>{const s=document.querySelector('[data-result-style]');s.value='original';s.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-results-preview]').click()})()");
  await waitUntil(childCdp, "document.querySelectorAll('.full-result-image').length>=3 && [...document.querySelectorAll('[data-result-figure]')].every(f=>f.dataset.mode==='original') && document.querySelector('[data-results-status]').textContent.includes('已准备')", 15000);
  failGate(await childCdp.value("(async()=>{const image=document.querySelector('[data-result-figure*=nodequality] img'),canvas=document.createElement('canvas');image.loading='eager';await image.decode();canvas.width=canvas.height=1;canvas.getContext('2d').drawImage(image,0,0);const color=canvas.getContext('2d').getImageData(0,0,1,1).data;return color[0]===29&&color[1]===29&&color[2]===30})()"), "Original terminal palette was not preserved");
  await childCdp.value("(()=>{const original=URL.createObjectURL;URL.createObjectURL=blob=>{window.__reportBlob=blob;return original(blob)};const click=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download){window.__reportDownloadName=this.download;return}return click.call(this)}})()");
  await childCdp.value("document.querySelector('[data-results-zip]').click()");
  await waitUntil(childCdp, "window.__reportBlob?.type==='application/zip'", 15000);
  const readBlob = async binary => {
    await childCdp.value(binary ? "window.__reportBlob.arrayBuffer().then(buffer=>{const bytes=new Uint8Array(buffer);let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));window.__reportFile=btoa(text)})" : "window.__reportBlob.text().then(text=>window.__reportFile=text)");
    const length = await childCdp.value("window.__reportFile.length"); let data = "";
    for (let offset = 0; offset < length; offset += 131072) data += await childCdp.value(`window.__reportFile.slice(${offset},${offset + 131072})`);
    return binary ? Buffer.from(data, "base64") : data;
  };
  const zipPath = join(profile, `results-${backend}.zip`); writeFileSync(zipPath, await readBlob(true));
  const validation = JSON.parse(execFileSync("python3", ["-c", "import sys,zipfile,json,struct\nwith zipfile.ZipFile(sys.argv[1]) as z:\n assert z.testzip() is None\n images=[n for n in z.namelist() if n.endswith('.png')]\n assert len(images)>=3\n for n in images:\n  data=z.read(n);assert data[:8]==b'\\x89PNG\\r\\n\\x1a\\n';assert struct.unpack('>I',data[16:20])[0]>=2000\n manifest=json.loads(z.read('results.json'));assert manifest['style']=='original';assert len(manifest['results'])==2\n print(json.dumps({'images':len(images),'style':manifest['style']}))", zipPath], { encoding: "utf8" }));
  failGate(validation.images >= 3, "ZIP omitted original result pages");
  await childCdp.value("(()=>{const s=document.querySelector('[data-result-style]');s.value='unified';s.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-results-clear]').click();document.querySelector('[data-result-list] input[data-result-id*=older]').click();window.__reportBlob=null;document.querySelector('[data-save-html]').click()})()");
  await waitUntil(childCdp, "window.__reportBlob?.type==='text/html;charset=utf-8'", 15000);
  const exported = await readBlob(false), match = exported.match(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/), payload = JSON.parse(match[1]);
  failGate(payload.fullResults.length === 1 && payload.fullResults[0].roundId.endsWith("older") && payload.resultStyle === "unified", "HTML must archive only the chosen full result");
  failGate(exported.includes("data:image/png;base64,") && !exported.includes("203.0.113.19") && !exported.includes("8.8.8.8"), "Embedded image HTML omitted images or leaked an address");
  const selectedPath = join(profile, `selected-results-${backend}.html`);
  writeFileSync(selectedPath, exported);
  const offlineTarget = (await cdp.call("Target.createTarget", { url: "about:blank" })).targetId;
  try {
    const offlineSession = (await cdp.call("Target.attachToTarget", { targetId: offlineTarget, flatten: true })).sessionId;
    await cdp.call("Page.enable", {}, offlineSession); await cdp.call("Runtime.enable", {}, offlineSession);
    await cdp.call("Network.enable", {}, offlineSession);
    await cdp.call("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, offlineSession);
    await cdp.call("Page.navigate", { url: new URL(`file://${selectedPath}`).href }, offlineSession);
    const offlineCdp = { value: expression => cdp.value(expression, undefined, offlineSession) };
    await waitUntil(offlineCdp, "document.querySelector('[data-chapter=network]')!==null", 5000);
    await offlineCdp.value("document.querySelector('[data-chapter=network]').click()");
    await waitUntil(offlineCdp, "[...document.querySelectorAll('.full-result-image')].length>0 && [...document.querySelectorAll('.full-result-image')].every(image=>image.complete&&image.naturalWidth>=2400)", 5000);
    await offlineCdp.value("document.querySelector('.full-result-image').click()");
    failGate(await offlineCdp.value("document.querySelector('.report-image-modal')?.open && document.querySelectorAll('[data-result-list] input').length===1"), "Selected HTML must preserve offline images, zoom, downloads and chosen history");
  } finally { await cdp.call("Target.closeTarget", { targetId: offlineTarget }); }
  if (process.env.BROWSER_REPORT_EXPORT_BASE) {
    writeFileSync(`${process.env.BROWSER_REPORT_EXPORT_BASE}-${backend}.zip`, readFileSync(zipPath));
    writeFileSync(`${process.env.BROWSER_REPORT_EXPORT_BASE}-${backend}.html`, exported);
  }
  // Restore the latest two runs for the regular report/PDF regression.
  await childCdp.value("document.querySelector('[data-results-latest]').click();document.querySelector('[data-results-preview]').click()");
  await waitUntil(childCdp, "document.querySelector('[data-results-status]').textContent.includes('已准备')", 12000);
}
