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
import { computeReport } from "@/utils/instanceReport/compute";
import {
  renderReportHtml,
  reportFilename,
} from "@/utils/instanceReport/render";
import type { ReportModel } from "@/utils/instanceReport/model";
import { throwIfReportAborted } from "@/utils/instanceReport/model";
import type { NodeInfo } from "@/types/komari";
import { Spinner } from "@/components/ui/Spinner";
import { parseReportDate } from "@/utils/instanceReport/dates";
import { overlayConfiguredNodeMeta } from "@/utils/nodeMetaOverlay";
import "@/styles/instance-report.css";

function saveFile(content: string, name: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ReportWorkspace({ meta, zone }: { meta: NodeInfo; zone: string }) {
  const current = useNodeMetrics(meta.uuid);
  const { resolvedAppearance } = usePreferences();
  const { data: auth } = useAuth();
  const { data: config } = usePublicConfig();
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
  const [busy, setBusy] = useState(false),
    [phase, setPhase] = useState("");
  const [error, setError] = useState("");
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
        event.data?.type !== "aster-report-size" ||
        event.data.id !== report?.model.reportId
      )
        return;
      const height = event.data.height;
      if (typeof height === "number" && Number.isFinite(height))
        setFrameHeight(Math.max(600, Math.min(200000, height + 8)));
    };
    window.addEventListener("message", resize);
    return () => window.removeEventListener("message", resize);
  }, [report?.model.reportId]);

  function preset(days: number | "month") {
    const now = Date.now();
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
          range: { start: start * 1000, end: end * 1000, timeZone: zone },
          theme: resolvedAppearance === "dark" ? "dark" : "light",
          showAddresses,
          compare,
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
                onClick={() =>
                  saveFile(
                    report.html,
                    reportFilename(report.model, "html"),
                    "text/html;charset=utf-8",
                  )
                }
              >
                <Download size={14} />
                下载原格式 HTML
              </button>
            </>
          )}
        </div>
      </header>
      {editing && (
        <section
          className="instance-report-form"
          aria-labelledby="instance-report-form-title"
        >
          <p className="instance-report-kicker">ASTER · COMPREHENSIVE REPORT</p>
          <h1 id="instance-report-form-title">
            为 {meta.name} 留下一份完整记录
          </h1>
          <p>
            选择日期，一键汇总资源、流量、Ping、既有网络检测、配置与资产信息。生成后可原样离线保存。
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
                ].map(([days, label]) => (
                  <button
                    type="button"
                    key={label}
                    onClick={() => preset(days as number | "month")}
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
                    onChange={(event) =>
                      setDraft((d) => ({ ...d, start: event.target.value }))
                    }
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
                所有日期与图表使用 {zone} · 精确到分钟 · 单份最长 366 天
              </p>
              <details className="instance-report-options">
                <summary>可选设置</summary>
                <label>
                  <input
                    type="checkbox"
                    checked={compare}
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
      {report && !editing && (
        <iframe
          ref={frame}
          className="instance-report-frame"
          title={`${report.model.node.name} VPS 全面报告`}
          sandbox="allow-scripts allow-downloads allow-modals"
          srcDoc={report.html}
          style={{ height: frameHeight }}
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
