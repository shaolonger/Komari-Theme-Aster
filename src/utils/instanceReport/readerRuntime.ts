/** Self-contained by design: this function is embedded in the downloaded HTML. */
export function readerRuntime() {
  const archive = document.getElementById("report-data");
  if (!archive) return;
  const model = JSON.parse(archive.textContent || "{}");
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: model.range.timeZone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const date = (t: number) => formatter.format(t);
  const number = (v: number, unit: string) => {
    if (unit === "B" || unit === "B/s") {
      const units = ["B", "KiB", "MiB", "GiB", "TiB"];
      const exponent =
        v > 0
          ? Math.min(4, Math.max(0, Math.floor(Math.log(v) / Math.log(1024))))
          : 0;
      return (
        (v / 1024 ** exponent).toFixed(2) +
        " " +
        units[exponent] +
        (unit === "B/s" ? "/s" : "")
      );
    }
    return v.toFixed(2) + (unit ? " " + unit : "");
  };
  function dataset(key: string): {
    points: { t: number; v: number | null }[];
    unit: string;
    label: string;
    step: number;
  } {
    if (key.startsWith("network:")) {
      const trend = model.networkTrends?.[Number(key.slice(8))];
      const points: { t: number; v: number | null }[] = trend?.points || [];
      const intervals = points.slice(1).map((p, i) => p.t - points[i]!.t).filter(v => v > 0).sort((a, b) => a - b);
      return { points, unit: trend?.unit || "", label: trend?.title || "网络观测", step: intervals.length ? intervals[Math.floor((intervals.length - 1) / 2)]! : 0 };
    }
    if (key.startsWith("ping:")) {
      const ping = model.pings.find(
        (p: { id: number }) => p.id === Number(key.slice(5)),
      );
      const points: { t: number; v: number | null }[] = ping?.points || [];
      const intervals = points
        .slice(1)
        .map((p, i) => p.t - points[i]!.t)
        .filter((v) => v > 0)
        .sort((a, b) => a - b);
      // A task's probe interval is not the returned rollup bucket interval.
      const step = intervals.length
        ? intervals[Math.floor((intervals.length - 1) / 2)]!
        : 0;
      return { points, unit: "ms", label: ping?.name || "Ping", step };
    }
    const metric = model.metrics.find((m: { key: string }) => m.key === key);
    return {
      points: metric?.points || [],
      unit: metric?.unit || "",
      label: metric?.label || key,
      step: model.stats[key]?.intervalMs || 0,
    };
  }
  function draw(container: HTMLElement) {
    if (container.dataset.chart === "traffic-daily") {
      drawTraffic(container);
      return;
    }
    if (container.dataset.chart?.startsWith("network-category:")) {
      drawNetworkCategory(container, Number(container.dataset.chart.slice(17)));
      return;
    }
    const data = dataset(container.dataset.chart || ""),
      full = data.points;
    const width = Math.max(200, Math.round(container.clientWidth)),
      height = 218,
      left = 57,
      right = 12,
      top = 22,
      bottom = 44;
    const pw = width - left - right,
      ph = height - top - bottom;
    const values = full.filter((p: { v: number | null }) => p.v != null);
    if (!values.length) {
      container.textContent = "所选期间没有有效观测值";
      return;
    }
    let maximum = 0,
      minimum = 0;
    for (const p of values) {
      maximum = Math.max(maximum, p.v || 0);
      minimum = Math.min(minimum, p.v || 0);
    }
    const ceiling = Math.max(1, maximum * 1.12),
      floor = minimum < 0 ? minimum * 1.12 : 0,
      y = (v: number) => top + ph - ((v - floor) / (ceiling - floor)) * ph;
    const x = (t: number) =>
      left +
      ((t - model.range.start) / (model.range.end - model.range.start)) * pw;
    // Split at every real null or cadence gap before reducing for display.
    // Otherwise isolated valid observations can disappear as invisible M-only paths.
    const segments: { t: number; v: number }[][] = [];
    let segment: { t: number; v: number }[] = [];
    let previousTime: number | null = null;
    const flush = () => { if (segment.length) segments.push(segment); segment = []; };
    const localCadence = (index: number) => {
      const side = (from: number, direction: -1 | 1) => {
        const values: number[] = [];
        for (let i = from; i >= 1 && i < full.length && values.length < 3; i += direction) {
          if (full[i - 1]!.v == null || full[i]!.v == null) break;
          const delta = full[i]!.t - full[i - 1]!.t; if (delta > 0) values.push(delta);
        }
        values.sort((a, b) => a - b);
        return values.length ? values[Math.floor((values.length - 1) / 2)]! : 0;
      };
      return Math.max(side(index, -1), side(index + 2, 1)) || data.step;
    };
    for (let i = 0; i < full.length; i++) {
      const p = full[i]!;
      if (p.v == null) { flush(); previousTime = null; continue; }
      const cadence = localCadence(i - 1);
      if (previousTime != null && cadence && p.t - previousTime > cadence * 1.5) flush();
      segment.push({ t: p.t, v: p.v }); previousTime = p.t;
    }
    flush();
    const stride = Math.max(1, Math.ceil(full.length / 200));
    const reduced = segments.map(group => {
      const points: { t: number; v: number }[] = [];
      for (let i = 0; i < group.length; i += stride) {
        const chunk = group.slice(i, i + stride);
        const min = chunk.reduce((a, p) => p.v < a.v ? p : a);
        const max = chunk.reduce((a, p) => p.v > a.v ? p : a);
        points.push(...[...new Set([chunk[0]!, chunk[chunk.length - 1]!, min, max])].sort((a, b) => a.t - b.t));
      }
      return points;
    });
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", data.label + "，单位 " + data.unit);
    const node = (
      tag: string,
      attributes: Record<string, string | number>,
      text?: string,
    ) => {
      const el = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attributes))
        el.setAttribute(k, String(v));
      if (text != null) el.textContent = text;
      svg.append(el);
      return el;
    };
    node("title", {}, data.label + " · 缺测处断开，数据精度见统计表");
    [0, 0.5, 1].forEach((ratio) => {
      const tick = floor + ratio * (ceiling - floor),
        yy = y(tick);
      node("line", {
        x1: left,
        y1: yy,
        x2: width - right,
        y2: yy,
        stroke: "var(--line)",
        "stroke-width": 1,
      });
      const label =
        data.unit === "B" || data.unit === "B/s"
          ? number(tick, "B").replace(/\.\d+/, "")
          : tick.toFixed(ceiling - floor < 10 ? 1 : 0);
      node(
        "text",
        {
          x: left - 7,
          y: yy + 4,
          "text-anchor": "end",
          fill: "var(--muted)",
          "font-size": 11,
        },
        label,
      );
    });
    node(
      "text",
      { x: left, y: 12, fill: "var(--muted)", "font-size": 11 },
      data.unit || "数值",
    );
    [0, 0.5, 1].forEach((ratio) =>
      node(
        "text",
        {
          x: left + ratio * pw,
          y: height - 25,
          "text-anchor": ratio === 0 ? "start" : ratio === 1 ? "end" : "middle",
          fill: "var(--muted)",
          "font-size": 11,
        },
        date(
          model.range.start + ratio * (model.range.end - model.range.start),
        ).split(" ")[0] || "",
      ),
    );
    node(
      "text",
      {
        x: left + pw / 2,
        y: height - 6,
        "text-anchor": "middle",
        fill: "var(--muted)",
        "font-size": 11,
      },
      "日期 · " + model.range.timeZone,
    );
    let path = "";
    for (const points of reduced) {
      if (points.length === 1) {
        node("circle", { cx: x(points[0]!.t), cy: y(points[0]!.v), r: 3, fill: "var(--blue)" });
      } else {
        points.forEach((p, i) => { path += `${i ? "L" : "M"}${x(p.t).toFixed(2)},${y(p.v).toFixed(2)} `; });
      }
    }
    node("path", { d: path, fill: "none", stroke: "var(--blue)", "stroke-width": 1.7, "stroke-linejoin": "round" });
    const guide = node("line", {
      x1: 0,
      x2: 0,
      y1: top,
      y2: height - bottom,
      stroke: "var(--muted)",
      opacity: 0,
    });
    const hit = node("rect", {
      x: left,
      y: top,
      width: pw,
      height: ph,
      fill: "transparent",
    });
    const tooltip = document.createElement("div");
    tooltip.className = "chart-tip";
    tooltip.hidden = true;
    const show = (event: Event) => {
      const clientX = (event as PointerEvent).clientX;
      const t =
        model.range.start +
        Math.max(
          0,
          Math.min(
            1,
            (clientX - container.getBoundingClientRect().left - left) / pw,
          ),
        ) *
          (model.range.end - model.range.start);
      let low = 0,
        high = full.length - 1;
      while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (full[mid]!.t < t) low = mid + 1;
        else high = mid;
      }
      const p =
        low > 0 && Math.abs(full[low - 1]!.t - t) < Math.abs(full[low]!.t - t)
          ? full[low - 1]!
          : full[low]!;
      tooltip.textContent =
        date(p.t) + " · " + (p.v == null ? "缺测" : number(p.v, data.unit));
      tooltip.hidden = false;
      guide.setAttribute("x1", String(x(p.t)));
      guide.setAttribute("x2", String(x(p.t)));
      guide.setAttribute("opacity", ".5");
    };
    hit.addEventListener("pointermove", show);
    hit.addEventListener("click", show);
    hit.addEventListener("pointerleave", () => {
      tooltip.hidden = true;
      guide.setAttribute("opacity", "0");
    });
    container.replaceChildren(svg, tooltip);
  }
  function drawNetworkCategory(container: HTMLElement, index: number) {
    const trend = model.networkTrends?.[index];
    const points: { t: number; label?: string; state: string }[] = trend?.points || [];
    if (!points.length) { container.textContent = "所选期间没有可用观测"; return; }
    const frequencies = new Map<string, number>();
    for (const point of points) { const label = point.label || "未知"; frequencies.set(label, (frequencies.get(label) || 0) + 1); }
    const ranked = [...frequencies].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([label]) => label);
    const labels = ranked.length > 12 ? [...ranked.slice(0, 11), "其他类别"] : ranked;
    const width = Math.max(200, container.clientWidth), height = 218, left = Math.min(130, width * .35), right = 12, top = 20, bottom = 43;
    const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", trend.title + "，按时间显示观测类别");
    const node = (tag: string, attrs: Record<string, string | number>, text?: string) => {
      const el = document.createElementNS(ns, tag); for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
      if (text != null) el.textContent = text; svg.append(el); return el;
    };
    const x = (t: number) => left + (t - model.range.start) / (model.range.end - model.range.start) * (width - left - right);
    const y = (i: number) => top + (i + .5) * (height - top - bottom) / labels.length;
    labels.forEach((label, i) => {
      node("line", { x1: left, x2: width - right, y1: y(i), y2: y(i), stroke: "var(--line)" });
      const text = node("text", { x: left - 7, y: y(i) + 4, "text-anchor": "end", fill: "var(--muted)", "font-size": 10 }, label.length > 15 ? label.slice(0, 14) + "…" : label);
      const title = document.createElementNS(ns, "title"); title.textContent = label; text.append(title);
    });
    // Coalesce only visually overlapping markers. The archive retains every observation.
    const bins = new Map<string, { x: number; y: number; label: string; count: number; time: number; state: string }>();
    for (const p of points) {
      const label = p.label || "未知", index = labels.indexOf(label), lane = index < 0 ? labels.length - 1 : index, px = x(p.t), key = `${lane}:${Math.floor(px / 3)}`;
      const old = bins.get(key); if (old) old.count++; else bins.set(key, { x: px, y: y(lane), label, count: 1, time: p.t, state: p.state });
    }
    for (const mark of bins.values()) {
      const dot = node("circle", { cx: mark.x, cy: mark.y, r: 3.5, fill: mark.state === "failed" || mark.state === "missing" ? "var(--amber)" : "var(--blue)", opacity: .8 });
      const title = document.createElementNS(ns, "title"); title.textContent = `${date(mark.time)} · ${mark.label}${mark.count > 1 ? ` · ${mark.count} 条重叠观测` : ""}`; dot.append(title);
    }
    [0, .5, 1].forEach(r => node("text", { x: left + r * (width - left - right), y: height - 24, "text-anchor": r === 0 ? "start" : r === 1 ? "end" : "middle", fill: "var(--muted)", "font-size": 10 }, date(model.range.start + r * (model.range.end - model.range.start)).split(" ")[0] || ""));
    node("text", { x: left + (width - left - right) / 2, y: height - 6, "text-anchor": "middle", fill: "var(--muted)", "font-size": 10 }, "日期 · " + model.range.timeZone);
    container.replaceChildren(svg);
  }
  function drawTraffic(container: HTMLElement) {
    const rows: { date: string; up: number | null; down: number | null }[] =
      model.traffic.daily;
    if (!rows.length) {
      container.textContent = "没有可用计数器增量";
      return;
    }
    const width = Math.max(200, container.clientWidth),
      height = 218,
      left = 57,
      right = 12,
      top = 22,
      bottom = 44;
    const pw = width - left - right,
      ph = height - top - bottom;
    let max = 1;
    rows.forEach((r) => {
      max = Math.max(max, (r.up ?? 0) + (r.down ?? 0));
    });
    max *= 1.1;
    const ns = "http://www.w3.org/2000/svg",
      svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("role", "img");
    svg.setAttribute(
      "aria-label",
      "每日已观测上下行流量，完整数值与缺项见下方表格",
    );
    const node = (
      tag: string,
      attrs: Record<string, string | number>,
      text?: string,
    ) => {
      const el = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
      if (text != null) el.textContent = text;
      svg.append(el);
      return el;
    };
    [0, 0.5, 1].forEach((r) => {
      const y = top + ph * (1 - r);
      node("line", {
        x1: left,
        x2: width - right,
        y1: y,
        y2: y,
        stroke: "var(--line)",
      });
      node(
        "text",
        {
          x: left - 7,
          y: y + 4,
          "text-anchor": "end",
          fill: "var(--muted)",
          "font-size": 11,
        },
        number(max * r, "B").replace(/\.\d+/, ""),
      );
    });
    const stride = pw / rows.length;
    rows.forEach((r, i) => {
      const down = ((r.down ?? 0) / max) * ph,
        up = ((r.up ?? 0) / max) * ph,
        x = left + stride * i + stride * 0.1,
        w = stride * 0.8;
      const a = node("rect", {
        x,
        y: top + ph - down,
        width: w,
        height: down,
        fill: "var(--blue)",
      });
      const b = node("rect", {
        x,
        y: top + ph - down - up,
        width: w,
        height: up,
        fill: "var(--purple)",
      });
      for (const el of [a, b]) {
        const title = document.createElementNS(ns, "title");
        title.textContent = `${r.date} · ↓ ${r.down == null ? "未采集" : number(r.down, "B")} / ↑ ${r.up == null ? "未采集" : number(r.up, "B")}`;
        el.append(title);
      }
    });
    [
      ...new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1]),
    ].forEach((i) =>
      node(
        "text",
        {
          x: left + (i + 0.5) * stride,
          y: height - 25,
          "text-anchor":
            i === 0 ? "start" : i === rows.length - 1 ? "end" : "middle",
          fill: "var(--muted)",
          "font-size": 11,
        },
        rows[i]!.date.slice(5),
      ),
    );
    node(
      "text",
      {
        x: left + pw / 2,
        y: height - 6,
        "text-anchor": "middle",
        fill: "var(--muted)",
        "font-size": 11,
      },
      "日期 · " + model.range.timeZone,
    );
    container.replaceChildren(svg);
  }
  const charts = Array.from(
    document.querySelectorAll<HTMLElement>("[data-chart]"),
  );
  function drawVisible() {
    for (const el of charts) if (el.clientWidth > 0) draw(el);
  }
  function chapter(id: string) {
    document.querySelectorAll<HTMLElement>(".chapter").forEach((el) => {
      el.hidden = el.id !== id;
    });
    document.querySelectorAll<HTMLElement>("[data-chapter]").forEach((el) => {
      if (el.dataset.chapter === id) el.setAttribute("aria-current", "page");
      else el.removeAttribute("aria-current");
    });
    drawVisible();
    window.parent.postMessage(
      {
        type: "aster-report-size",
        id: model.reportId,
        height: document.documentElement.scrollHeight,
      },
      "*",
    );
  }
  document.addEventListener("click", (event) => {
    const element = (event.target as Element).closest<HTMLElement>(
      "[data-chapter],[data-jump],[data-print],[data-json]",
    );
    if (!element) return;
    if (element.dataset.chapter || element.dataset.jump) {
      chapter(element.dataset.chapter || element.dataset.jump || "overview");
      document
        .getElementById(
          element.dataset.chapter || element.dataset.jump || "overview",
        )
        ?.scrollIntoView({ block: "start" });
    }
    if (element.hasAttribute("data-print")) window.print();
    if (element.hasAttribute("data-json")) {
      const url = URL.createObjectURL(
          new Blob([JSON.stringify(model, null, 2)], {
            type: "application/json",
          }),
        ),
        a = document.createElement("a");
      a.href = url;
      a.download = "Aster-" + model.reportId + ".json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  });
  const details = Array.from(
    document.querySelectorAll<HTMLDetailsElement>("details"),
  );
  let previouslyOpen: boolean[] = [];
  window.addEventListener("beforeprint", () => {
    previouslyOpen = details.map((d) => d.open);
    details.forEach((d) => {
      d.open = true;
    });
    drawVisible();
  });
  window.addEventListener("afterprint", () =>
    details.forEach((d, i) => {
      d.open = previouslyOpen[i] || false;
    }),
  );
  const resize = new ResizeObserver(() => {
    drawVisible();
    window.parent.postMessage(
      {
        type: "aster-report-size",
        id: model.reportId,
        height: document.documentElement.scrollHeight,
      },
      "*",
    );
  });
  charts.forEach((c) => resize.observe(c));
  resize.observe(document.body);
  chapter("overview");
}
