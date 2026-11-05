import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ChevronLeft, Download, FileChartColumn } from "lucide-react";
import {
  useNodeMeta,
  useNodeMetrics,
  useNodeStoreStatus,
} from "@/hooks/useNode";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { usePreferences } from "@/hooks/usePreferences";
import { useAuth } from "@/hooks/useAuth";
import { usePublicConfig } from "@/hooks/usePublicConfig";
import {
  getBrowserTimeZone,
  formatDateTimeLocalValue,
  parseDateTimeLocalInZone,
  getZonedDateTimeParts,
} from "@/utils/timeDisplay";
import { collectReportInput } from "@/services/instanceReport";
import { loadReportOriginalImages } from "@/services/reportOriginalImages";
import { computeReport } from "@/utils/instanceReport/compute";
import { renderReportHtml } from "@/utils/instanceReport/render";
import type { ReportModel } from "@/utils/instanceReport/model";
import { throwIfReportAborted } from "@/utils/instanceReport/model";
import type { NodeInfo } from "@/types/komari";
import { Spinner } from "@/components/ui/Spinner";
import { parseReportDate } from "@/utils/instanceReport/dates";
import { overlayConfiguredNodeMeta } from "@/utils/nodeMetaOverlay";
import { redactReport } from "@/utils/instanceReport/privacy";
import "@/styles/instance-report.css";

function ReportWorkspace({ meta, zone }: { meta: NodeInfo; zone: string }) {
  const current = useNodeMetrics(meta.uuid);
  const { resolvedAppearance } = usePreferences();
  const { data: auth } = useAuth();
  const { data: config } = usePublicConfig();
  const settings = useThemeSettings();
  const [resultStyle, setResultStyle] = useState<"unified" | "original">(settings.reportResultStyle);
  const [search, setSearch] = useSearchParams();
  const frame = useRef<HTMLIFrameElement>(null),
    pending = useRef<AbortController | null>(null);
  const initialEnd = Date.now();
  const [draft, setDraft] = useState(() => {
    const start = Date.parse(search.get("start") || ""),
      end = Date.parse(search.get("end") || "");
    return {
      start: formatDateTimeLocalValue(
        (Number.isFinite(start) ? start : initialEnd - 7 * 86400000) / 1000,
        zone,
      ),
      end: formatDateTimeLocalValue(
        (Number.isFinite(end) ? end : initialEnd) / 1000,
        zone,
      ),
    };
  });
  const [compare, setCompare] = useState(false),
    [showAddresses, setShowAddresses] = useState(false);
  const [allHistory, setAllHistory] = useState(() => search.get("scope") === "all");
  const [busy, setBusy] = useState(false),
    [phase, setPhase] = useState("");
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [report, setReport] = useState<{
    model: ReportModel;
    html: string;
  } | null>(null);
  const [editing, setEditing] = useState(true),
    [frameHeight, setFrameHeight] = useState(900);

  useEffect(
    () => () => {
      pending.current?.abort();
    },
    [],
  );
  useEffect(() => {
    const resize = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.data?.id !== report?.model.reportId
      )
        return;
      if (event.data.type === "aster-report-original-request") {
        const result = report?.model.fullResults?.find(result => result.id === event.data.resultId);
        if (!result || result.module !== "tcpquality-full") return;
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000);
        const source = event.source as Window;
        void (async () => {
          try {
            const pages = await loadReportOriginalImages(meta.uuid, result.roundId, controller.signal);
            const clean = redactReport({ ...report!.model, metrics: [], pings: [], network: [], fullResults: [{ ...result, originalPages: pages }] });
            source.postMessage({ type: "aster-report-original-response", id: report!.model.reportId, requestId: event.data.requestId, pages: clean.fullResults![0]!.originalPages }, "*");
          } catch (error) {
            source.postMessage({ type: "aster-report-original-response", id: report!.model.reportId, requestId: event.data.requestId, error: error instanceof Error ? error.message : String(error) }, "*");
          } finally { clearTimeout(timer); }
        })();
        return;
      }
      if (event.data.type === "aster-report-export-error") { setError(String(event.data.error)); return; }
      if (event.data.type === "aster-report-export-state") { setExporting(event.data.busy === true); if (event.data.busy === true) setError(""); return; }
      if (event.data.type !== "aster-report-size") return;
      const height = event.data.height;
      if (typeof height === "number" && Number.isFinite(height))
        setFrameHeight(Math.max(600, Math.min(200000, height + 8)));
    };
    window.addEventListener("message", resize);
    return () => window.removeEventListener("message", resize);
  }, [report, meta.uuid]);

  function preset(days: number | "month" | "all") {
    const now = Date.now();
    setAllHistory(days === "all");
    if (days === "all") {
      setCompare(false);
      setDraft({ start: formatDateTimeLocalValue(0, zone), end: formatDateTimeLocalValue(now / 1000, zone) });
      return;
    }
    let start: number;
    if (days === "month") {
      const p = getZonedDateTimeParts(now, zone);
      start =
        (parseDateTimeLocalInZone(
          `${p.year}-${String(p.month).padStart(2, "0")}-01T00:00`,
          zone,
        ) ?? now / 1000) * 1000;
    } else start = now - days * 86400000;
    setDraft({
      start: formatDateTimeLocalValue(start / 1000, zone),
      end: formatDateTimeLocalValue(now / 1000, zone),
    });
  }
  async function generate() {
    const start = parseReportDate(draft.start, zone),
      end = parseReportDate(draft.end, zone);
    if (
      start == null ||
      end == null ||
      end <= start ||
      end * 1000 > Date.now()
    ) {
      setError("日期无效或超出当前时间，请检查起止时间和所选时区。");
      return;
    }
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    try {
      const input = await collectReportInput(
        {
          meta: { ...meta },
          current: current ? { ...current } : undefined,
          range: { start: allHistory ? 0 : start * 1000, end: end * 1000, timeZone: zone, allHistory },
          theme: resolvedAppearance === "dark" ? "dark" : "light",
          showAddresses,
          compare,
          resultStyle,
          loggedIn: auth?.logged_in === true,
        },
        controller.signal,
        (text) => {
          if (!controller.signal.aborted) setPhase(text);
        },
      );
      const model = await computeReport(input, controller.signal);
      throwIfReportAborted(controller.signal);
      const html = renderReportHtml(model);
      throwIfReportAborted(controller.signal);
      setReport({ model, html });
      setEditing(false);
      setFrameHeight(900);
      setSearch(
        {
          start: new Date(input.range.start).toISOString(),
          end: new Date(input.range.end).toISOString(),
          ...(input.range.allHistory ? { scope: "all" } : {}),
        },
        { replace: true },
      );
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error ? cause.message : "报告生成失败，请重试。",
        );
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  }
  const retention = (hours: number | undefined) =>
    hours && hours > 0
      ? `约 ${hours} 小时（实际覆盖以查询为准）`
      : "需查询确认";
  return (
    <div className="instance-report-page">
      <header className="instance-report-page-top">
        <Link
          to={`/instance/${encodeURIComponent(meta.uuid)}`}
          className="instance-page-back"
        >
          <ChevronLeft size={14} />
          返回 VPS 详情
        </Link>
        <div className="instance-report-page-actions">
          {report && (
            <>
              <button
                type="button"
                onClick={() => setEditing(!editing)}
                disabled={busy}
              >
                {editing ? "继续阅读报告" : "调整日期 / 重新生成"}
              </button>
              <button
                type="button"
                disabled={exporting}
                onClick={() => frame.current?.contentWindow?.postMessage({ type: "aster-report-export-html", id: report.model.reportId }, "*")}
              >
                <Download size={14} />
                {exporting ? "正在准备图片…" : "下载含图片 HTML"}
              </button>
            </>
          )}
        </div>
      </header>
      {!editing && error && <p className="instance-report-error" role="alert">{error}</p>}
      {editing && (
        <section
          className="instance-report-form"
          aria-labelledby="instance-report-form-title"
        >
          <p className="instance-report-kicker">ASTER · COMPREHENSIVE REPORT</p>
          <h1 id="instance-report-form-title">
            为 {meta.name} 生成一份可视化报告
          </h1>
          <p>
            用图表回顾资源、流量和网络体验，自选完整检测结果，导出可离线阅读的 HTML、PDF 与高清图片。
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void generate();
            }}
          >
            <fieldset disabled={busy}>
              <legend className="sr-only">报告范围与选项</legend>
              <div className="instance-report-presets">
                {[
                  [1, "最近 24 小时"],
                  [7, "最近 7 天"],
                  [30, "最近 30 天"],
                  ["month", "本月"],
                  ["all", "全部历史"],
                ].map(([days, label]) => (
                  <button
                    type="button"
                    key={label}
                    onClick={() => preset(days as number | "month" | "all")}
                    aria-pressed={days === "all" ? allHistory : undefined}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="instance-report-dates">
                <label>
                  开始时间
                  <input
                    type="datetime-local"
                    required
                    value={draft.start}
                    onChange={(event) => { setAllHistory(false); setDraft((d) => ({ ...d, start: event.target.value })); }}
                  />
                </label>
                <label>
                  结束时间
                  <input
                    type="datetime-local"
                    required
                    max={formatDateTimeLocalValue(Date.now() / 1000, zone)}
                    value={draft.end}
                    onChange={(event) =>
                      setDraft((d) => ({ ...d, end: event.target.value }))
                    }
                  />
                </label>
              </div>
              <p className="instance-report-zone">
                所有日期与图表使用 {zone} · 精确到分钟{allHistory ? " · 从最早可读取的数据开始展示" : ""}
              </p>
              <label className="instance-report-result-style">结果图片样式<select aria-label="生成报告的结果图片样式" value={resultStyle} onChange={event => setResultStyle(event.target.value === "original" ? "original" : "unified")}><option value="unified">统一图表版（默认）</option><option value="original">上游原始版</option></select><small>生成后可逐轮选择导出结果；原始版保留上游内容与外观。</small></label>
              <details className="instance-report-options">
                <summary>可选设置</summary>
                <label>
                  <input
                    type="checkbox"
                    checked={compare}
                    disabled={allHistory}
                    onChange={(event) => setCompare(event.target.checked)}
                  />
                  与前一等长区间比较
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={showAddresses}
                    onChange={(event) => setShowAddresses(event.target.checked)}
                  />
                  报告包含完整 IP 与检测目标
                </label>
                <p>
                  默认脱敏同时作用于在线预览、离线 HTML 与
                  JSON。完整地址只在当前权限允许时读取。
                </p>
              </details>
              <div className="instance-report-retention">
                <h2>预计数据可用范围</h2>
                <div>
                  <span>资源与流量</span>
                  <strong>{retention(config?.record_preserve_time)}</strong>
                </div>
                <div>
                  <span>Ping 历史</span>
                  <strong>
                    {retention(config?.ping_record_preserve_time)}
                  </strong>
                </div>
                <div>
                  <span>网络检测</span>
                  <strong>按插件的明细 / 摘要保留期</strong>
                </div>
                <div>
                  <span>配置与资产</span>
                  <strong>生成时快照</strong>
                </div>
                <p>
                  超出保留期仍可生成，报告会明确说明缺项。仅整理既有测量，不触发新的测速或探测。
                </p>
              </div>
              <button className="instance-report-generate" type="submit">
                <FileChartColumn size={16} />
                生成全面报告
              </button>
            </fieldset>
          </form>
          {busy && (
            <div className="instance-report-progress" role="status">
              <Spinner />
              <span>{phase}</span>
              <button
                type="button"
                onClick={() => {
                  pending.current?.abort();
                  pending.current = null;
                  setBusy(false);
                  setPhase("");
                }}
              >
                取消生成
              </button>
            </div>
          )}
          {error && (
            <p className="instance-report-error" role="alert">
              {error}
            </p>
          )}
          <p className="instance-report-form-note">
            离线 HTML 保留全部章节、图表和数据；PDF 可在报告内选择「打印 / 存为
            PDF」。历史在线率、安全审计或未采集的 IO 数据不会被推测填充。
          </p>
        </section>
      )}
      {report && (
        <iframe
          key={report.model.reportId}
          ref={frame}
          className="instance-report-frame"
          title={`${report.model.node.name} VPS 全面报告`}
          sandbox="allow-scripts allow-downloads allow-modals allow-popups allow-popups-to-escape-sandbox"
          srcDoc={report.html}
          style={{ height: frameHeight, display: editing ? "none" : undefined }}
        />
      )}
    </div>
  );
}

export default function InstanceReport() {
  const { uuid = "" } = useParams<{ uuid: string }>();
  const meta = useNodeMeta(uuid),
    status = useNodeStoreStatus();
  const settings = useThemeSettings();
  if (!meta || !settings.isReady)
    return (
      <div className="instance-report-loading">
        <Spinner />
        <p>
          {status.failureStreak
            ? "节点资料读取失败，请稍后重试或返回详情页。"
            : "正在读取节点资料…"}
        </p>
        <Link to={`/instance/${encodeURIComponent(uuid)}`}>返回详情页</Link>
      </div>
    );
  const zone =
    settings.displayTimeZone === "system"
      ? getBrowserTimeZone()
      : settings.displayTimeZone;
  return (
    <ReportWorkspace
      key={`${uuid}:${zone}`}
      meta={overlayConfiguredNodeMeta(meta, settings.homeNodeFacets)}
      zone={zone}
    />
  );
}
