import type { ReportFullResult, ReportModel } from "./model";
import type { ResultToolkit } from "./resultToolkit";

/** No runtime imports: embedded alongside the chart reader in the offline HTML. */
export function resultReaderRuntime(model: ReportModel, tools: ResultToolkit) {
  const results = model.fullResults || [];
  const stored = model as ReportModel & { selectedResultIds?: string[] };
  const latest = () => [...new Map([...results].reverse().map(result => [result.module, result.id])).values()];
  let selected = new Set(stored.selectedResultIds || latest()), page = 0, query = "", generation = 0;
  let mode: "original" | "unified" = model.resultStyle === "original" ? "original" : "unified";
  let busy = false;
  const cache = new Map<string, string[]>(), pending = new Map<string, { resolve: (pages: { title: string; svg: string }[]) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const list = document.querySelector<HTMLElement>("[data-result-list]"), images = document.querySelector<HTMLElement>("[data-result-images]");
  const status = document.querySelector<HTMLElement>("[data-results-status]");
  const date = (t: number) => new Intl.DateTimeFormat("zh-CN", { timeZone: model.range.timeZone, dateStyle: "medium", timeStyle: "short" }).format(t);
  const safeName = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 100);
  const notify = (message: string) => { if (status) status.textContent = message; const banner = document.querySelector("[data-export-status]"); if (banner) banner.textContent = message; };
  const chosen = () => results.filter(result => selected.has(result.id));
  const persist = () => { stored.selectedResultIds = [...selected]; model.resultStyle = mode; };
  const download = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  };
  function preview(source: string, name: string) {
    document.querySelector(".report-image-modal")?.remove();
    const dialog = document.createElement("dialog"); dialog.className = "report-image-modal";
    const header = document.createElement("header"), close = document.createElement("button"), save = document.createElement("button"), image = document.createElement("img");
    close.textContent = "关闭预览"; close.onclick = () => dialog.close(); save.textContent = "下载此张高清 PNG";
    save.onclick = () => { const bytes = Uint8Array.from(atob(source.slice(source.indexOf(",") + 1)), c => c.charCodeAt(0)); download(new Blob([bytes.buffer], { type: "image/png" }), name); };
    image.src = source; image.alt = "高清检测结果预览"; header.append(save, close); dialog.append(header, image); document.body.append(dialog); dialog.showModal();
  }
  function bindImage(image: HTMLImageElement, source: string, roundId: string, index: number) {
    image.tabIndex = 0; image.setAttribute("role", "button"); image.title = "点击放大或下载这张高清图片";
    const open = () => preview(source, `Aster-${safeName(roundId)}-${index + 1}.png`);
    image.onclick = open; image.onkeydown = event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } };
  }
  const inline = (blob: Blob) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("图片读取失败")); reader.readAsDataURL(blob); });
  for (const figure of document.querySelectorAll<HTMLElement>("[data-result-figure]")) {
    const id = figure.dataset.resultFigure, style = figure.dataset.mode;
    if (!id || !style) continue;
    const values = [...figure.querySelectorAll<HTMLImageElement>("img")].map(image => image.src).filter(value => value.startsWith("data:image/png;base64,"));
    if (values.length) cache.set(`${style}:${id}`, values);
    const result = results.find(result => result.id === id);
    if (result) [...figure.querySelectorAll<HTMLImageElement>("img")].forEach((image, index) => bindImage(image, image.src, result.roundId, index));
  }
  function renderList() {
    persist();
    if (!list) return;
    const visible = results.filter(result => `${tools.title(result)} ${date(result.time)} ${result.roundId}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
    const pages = Math.max(1, Math.ceil(visible.length / 10)); page = Math.max(0, Math.min(pages - 1, page)); list.replaceChildren();
    for (const result of visible.slice(page * 10, page * 10 + 10)) {
      const row = document.createElement("div"); row.className = "result-row";
      const label = document.createElement("label"), checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.checked = selected.has(result.id); checkbox.dataset.resultId = result.id; checkbox.setAttribute("aria-label", `选择 ${tools.title(result)} ${date(result.time)} ${result.roundId}`);
      checkbox.addEventListener("change", () => { generation++; if (checkbox.checked) selected.add(result.id); else selected.delete(result.id); renderList(); markSelection(); });
      const identity = document.createElement("span"), name = document.createElement("strong"), time = document.createElement("small"); name.textContent = `${tools.title(result)} · ${tools.status(result.state)}${result.truncated ? " · 保存内容不完整" : ""}`; time.textContent = `${date(result.time)} · ${result.roundId}`; identity.append(name, time); label.append(checkbox, identity); row.append(label);
      if (result.url) { const link = document.createElement("a"); link.href = result.url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = "原报告 ↗"; row.append(link); }
      else { const missing = document.createElement("span"); missing.className = "muted"; missing.textContent = "未提供链接"; row.append(missing); }
      list.append(row);
    }
    if (!visible.length) { const empty = document.createElement("p"); empty.textContent = "没有匹配的检测结果。"; list.append(empty); }
    const count = document.querySelector("[data-results-count]"), counter = document.querySelector("[data-results-page]");
    if (count) count.textContent = `已选择 ${selected.size} / ${results.length} 份`;
    if (counter) counter.textContent = `${page + 1} / ${pages}`;
    const prev = document.querySelector<HTMLButtonElement>("[data-results-prev]"), next = document.querySelector<HTMLButtonElement>("[data-results-next]");
    if (prev) prev.disabled = page === 0; if (next) next.disabled = page >= pages - 1;
  }
  function markSelection() {
    for (const figure of images?.querySelectorAll<HTMLElement>("[data-result-figure]") || []) figure.hidden = !selected.has(figure.dataset.resultFigure || "") || figure.dataset.mode !== mode;
    notify(selected.size ? `已选择 ${selected.size} 份，预览或导出时生成所选高清结果图片。` : "请选择要导出的检测结果。");
  }
  function originalPages(result: ReportFullResult) {
    if (result.module !== "tcpquality-full" || result.originalPages?.length) return Promise.resolve();
    if (window.parent === window) return Promise.reject(new Error("这份离线文件未包含此轮原始图片，请在线选择原始版后重新导出。"));
    const requestId = `${model.reportId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error("上游原始图片读取超时，请稍后重试。")); }, 35000);
      pending.set(requestId, { timer, resolve: pages => { result.originalPages = pages; resolve(); }, reject });
      window.parent.postMessage({ type: "aster-report-original-request", id: model.reportId, resultId: result.id, requestId }, "*");
    });
  }
  window.addEventListener("message", event => {
    if (event.source !== window.parent || event.data?.id !== model.reportId) return;
    if (event.data.type === "aster-report-original-response") {
      const request = pending.get(event.data.requestId); if (!request) return;
      pending.delete(event.data.requestId); clearTimeout(request.timer);
      if (event.data.error || !Array.isArray(event.data.pages) || !event.data.pages.length) request.reject(new Error(event.data.error || "此轮没有原始图片")); else request.resolve(event.data.pages);
    }
    if (event.data.type === "aster-report-export-html") void saveHtml().catch(showError);
  });
  const showError = (error: unknown) => { notify(error instanceof Error ? error.message : String(error)); window.parent.postMessage({ type: "aster-report-export-error", id: model.reportId, error: error instanceof Error ? error.message : String(error) }, "*"); };
  async function prepare() {
    if (!results.length) return;
    if (busy) throw new Error("结果图片正在准备，请等待完成或取消后重试。");
    if (!selected.size) { if (images) images.replaceChildren(); notify("未选择完整检测结果，导出将仅包含报告图表。"); return; }
    const own = ++generation, selectedMode = mode, items = chosen(); let bytes = 0;
    busy = true;
    window.parent.postMessage({ type: "aster-report-export-state", id: model.reportId, busy: true }, "*");
    const cancel = document.querySelector<HTMLButtonElement>("[data-results-cancel]"); if (cancel) cancel.hidden = false;
    try {
      for (let i = 0; i < items.length; i++) {
        if (generation !== own) throw new Error("图片生成已取消；已完成的图片仍可复用。");
        const result = items[i]!, key = `${selectedMode}:${result.id}`;
        notify(`正在准备 ${i + 1} / ${items.length} · ${tools.title(result)} · ${date(result.time)}`);
        if (!cache.has(key)) {
          if (selectedMode === "original") await originalPages(result);
          let pages: string[];
          try { pages = selectedMode === "original" ? tools.original(result) : tools.unified(result, model.node.name, model.range.timeZone); }
          catch (error) { throw new Error(`${tools.title(result)} · ${date(result.time)}：${error instanceof Error ? error.message : error} 可取消选择此轮，或切换到统一图表版。`); }
          const urls: string[] = [];
          for (const svg of pages) {
            if (generation !== own) throw new Error("图片生成已取消。");
            const blob = await tools.png(svg); bytes += blob.size;
            if (bytes > 80 * 1024 * 1024) throw new Error("所选图片超过 80 MiB，请减少结果数量或分批导出。");
            urls.push(await inline(blob)); await new Promise(resolve => setTimeout(resolve, 0));
          }
          cache.set(key, urls);
        }
      }
      if (generation !== own) throw new Error("图片生成已取消。");
      if (images) {
        images.replaceChildren();
        for (const result of items) {
          const figure = document.createElement("figure"); figure.className = "full-result-figure"; figure.dataset.resultFigure = result.id; figure.dataset.mode = selectedMode;
          const heading = document.createElement("figcaption"); heading.textContent = `${tools.title(result)} · ${date(result.time)} · ${selectedMode === "original" ? "上游原始版" : "统一图表版"}`; figure.append(heading);
          if (result.url) { const link = document.createElement("a"); link.href = result.url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = "查看本轮原报告 ↗"; figure.append(link); }
          for (const [index, source] of (cache.get(`${selectedMode}:${result.id}`) || []).entries()) {
            const image = document.createElement("img"); image.src = source; image.alt = `${tools.title(result)} ${date(result.time)} 结果第 ${index + 1} 页`; image.className = "full-result-image"; image.decoding = "async"; image.loading = "lazy"; figure.append(image);
            bindImage(image, source, result.roundId, index);
          }
          images.append(figure);
        }
      }
      notify(`已准备 ${items.length} 份结果，共 ${items.reduce((n, result) => n + (cache.get(`${selectedMode}:${result.id}`)?.length || 0), 0)} 张高清图片。`);
    } finally { busy = false; if (cancel) cancel.hidden = true; window.parent.postMessage({ type: "aster-report-export-state", id: model.reportId, busy: false }, "*"); }
  }
  async function exportZip() {
    if (!selected.size) throw new Error("请先选择要下载的检测结果。");
    await prepare();
    const files: { name: string; bytes: Uint8Array }[] = [];
    for (const result of chosen()) for (const [index, source] of (cache.get(`${mode}:${result.id}`) || []).entries()) {
      const raw = atob(source.slice(source.indexOf(",") + 1));
      files.push({ name: `${result.module}/${new Date(result.time).toISOString().replace(/[:.]/g, "-")}-${safeName(result.roundId)}/${String(index + 1).padStart(2, "0")}.png`, bytes: Uint8Array.from(raw, c => c.charCodeAt(0)) });
    }
    files.push({ name: "results.json", bytes: new TextEncoder().encode(JSON.stringify({ style: mode, node: model.node.name, timeZone: model.range.timeZone, results: chosen().map(result => ({ id: result.roundId, module: result.module, time: result.time, state: result.state, reportUrl: result.url, truncated: result.truncated })) }, null, 2)) });
    const bytes = tools.zip(files); download(new Blob([Uint8Array.from(bytes).buffer], { type: "application/zip" }), `Aster-${safeName(model.node.name)}-results-${mode}.zip`);
  }
  async function saveHtml() {
    await prepare(); persist();
    const root = document.documentElement.cloneNode(true) as HTMLElement;
    const exported = { ...model, fullResults: chosen(), selectedResultIds: [...selected], resultStyle: mode };
    const data = root.querySelector("#report-data");
    if (data) data.textContent = JSON.stringify(exported).replace(/[<>&\u2028\u2029]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
    root.querySelector("[data-result-list]")?.replaceChildren();
    root.querySelectorAll<HTMLElement>("[data-result-figure]").forEach(figure => { if (!selected.has(figure.dataset.resultFigure || "") || figure.dataset.mode !== mode) figure.remove(); });
    root.querySelectorAll(".chart-tip").forEach(tip => tip.remove());
    root.querySelectorAll(".report-image-modal").forEach(dialog => dialog.remove());
    const html = "<!doctype html>" + root.outerHTML;
    if (new TextEncoder().encode(html).length > 128 * 1024 * 1024) throw new Error("HTML 超过 128 MiB，请减少所选结果。");
    download(new Blob([html], { type: "text/html;charset=utf-8" }), `Aster-${safeName(model.node.name)}-${safeName(model.reportId)}.html`);
  }
  async function print() {
    await prepare();
    const all = [...document.querySelectorAll<HTMLImageElement>(".full-result-image")];
    for (const image of all) { image.loading = "eager"; await image.decode(); }
    window.print();
  }
  document.querySelector<HTMLInputElement>("[data-result-search]")?.addEventListener("input", event => { query = (event.target as HTMLInputElement).value; page = 0; renderList(); });
  document.querySelector<HTMLSelectElement>("[data-result-style]")?.addEventListener("change", event => { generation++; mode = (event.target as HTMLSelectElement).value === "original" ? "original" : "unified"; persist(); markSelection(); });
  document.addEventListener("click", event => {
    const button = (event.target as Element).closest<HTMLElement>("[data-results-latest],[data-results-all],[data-results-clear],[data-results-prev],[data-results-next],[data-results-preview],[data-results-zip],[data-results-cancel],[data-save-html]"); if (!button) return;
    if (button.hasAttribute("data-results-preview")) { void prepare().catch(showError); return; }
    if (button.hasAttribute("data-results-zip")) { void exportZip().catch(showError); return; }
    if (button.hasAttribute("data-save-html")) { void saveHtml().catch(showError); return; }
    if (button.hasAttribute("data-results-cancel")) { generation++; notify("正在取消图片生成…"); return; }
    if (button.hasAttribute("data-results-prev")) page--; else if (button.hasAttribute("data-results-next")) page++;
    else { generation++; selected = new Set(button.hasAttribute("data-results-latest") ? latest() : button.hasAttribute("data-results-all") ? results.map(result => result.id) : []); markSelection(); }
    renderList();
  });
  const styleSelect = document.querySelector<HTMLSelectElement>("[data-result-style]"); if (styleSelect) styleSelect.value = mode;
  renderList();
  return { prepare, saveHtml, print, onChapter: (id: string) => { if (id === "network" && results.length && !images?.children.length && !busy) void prepare().catch(showError); } };
}
