import { useState } from "react";
import type {
  ReportMeasurement,
  ReportRound,
  ReportSlot,
} from "@/services/reportObservatory";
import { numberText, reportLabels } from "./reportMetrics";

export function SpeedReport({
  round,
  onInspect,
}: {
  round: ReportRound;
  onInspect: (slot: ReportSlot, result?: ReportMeasurement) => void;
}) {
  const [direction, setDirection] = useState("download"),
    [streams, setStreams] = useState(1);
  const rows = round.slots.map((slot) => {
    const result = round.measurements.find((r) => r.slotId === slot.id);
    const run = result?.data.runs?.find(
      (r) => r.streams === streams && r.vpsDirection === direction,
    );
    return { slot, result, run };
  });
  const maximum = Math.max(
    1,
    ...rows.flatMap(
      ({ run }) => run?.intervals.map((i) => i.bitsPerSecond || 0) || [],
    ),
  );
  const traffic = round.measurements.reduce(
    (sum, r) =>
      sum +
      (r.data.runs || []).reduce(
        (n, run) => n + (run.trafficBytesObserved || 0),
        0,
      ),
    0,
  );
  return (
    <>
      <div className="report-filter-row">
        <div className="report-pills" aria-label="以 VPS 为参照的流量方向">
          {[
            ["download", "下行 · 流入 VPS"],
            ["upload", "上行 · 流出 VPS"],
          ].map(([key, label]) => (
            <button
              key={key}
              aria-pressed={direction === key}
              onClick={() => setDirection(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="report-pills" aria-label="连接数">
          {round.parameters.streams.map((n) => (
            <button
              key={n}
              aria-pressed={streams === n}
              onClick={() => setStreams(n)}
            >
              {n === 1 ? "单连接 P1" : `多连接 P${n} · 独立测试`}
            </button>
          ))}
        </div>
      </div>
      <p className="report-caption">
        不设置带宽上限 · 接收端均值 · 最大值仅取完整一秒区间 · 预热{" "}
        {round.parameters.warmupSeconds} 秒，测量 {round.parameters.seconds}{" "}
        秒。共享端点、CPU 和 TCP 拥塞控制会影响实际结果。
      </p>
      <div className="report-table-scroll">
        <table className="report-speed-table">
          <thead>
            <tr>
              <th>测量地区 / 运营商</th>
              <th>每秒速率 · 统一纵轴</th>
              <th>平均 Mbps</th>
              <th>最大 Mbps</th>
              <th>TCP RTT ms</th>
              <th>发送端重传</th>
              <th>实际流量</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ slot, result, run }) => (
              <tr key={slot.id}>
                <td>
                  <button
                    className="report-target-name"
                    onClick={() => onInspect(slot, result)}
                  >
                    {[slot.source.city, slot.source.carrier]
                      .filter(Boolean)
                      .join(" ") ||
                      slot.endpoint?.name ||
                      slot.target ||
                      "未覆盖"}
                  </button>
                  <small>
                    {slot.source.provider} ·{" "}
                    {run?.state
                      ? reportLabels[run.state] || run.state
                      : reportLabels[slot.state]}
                  </small>
                </td>
                <td>
                  <button
                    className="report-speed-curve"
                    onClick={() => onInspect(slot, result)}
                    aria-label={`${slot.source.city || slot.target} ${direction === "download" ? "下行" : "上行"}逐秒速率`}
                  >
                    <svg
                      viewBox="0 0 200 40"
                      preserveAspectRatio="none"
                      role="img"
                      aria-label="每秒接收端速率"
                    >
                      {run?.intervals.map((i, index, all) => (
                        <rect
                          key={index}
                          x={(index * 200) / all.length}
                          y={40 - ((i.bitsPerSecond || 0) / maximum) * 40}
                          width={200 / all.length + 0.2}
                          height={((i.bitsPerSecond || 0) / maximum) * 40}
                        >
                          <title>
                            {i.start?.toFixed(2)}–{i.end?.toFixed(2)} s ·{" "}
                            {numberText(
                              i.bitsPerSecond === null
                                ? null
                                : i.bitsPerSecond / 1e6,
                            )}{" "}
                            Mbps
                          </title>
                        </rect>
                      ))}
                    </svg>
                  </button>
                  {!run?.intervals.length && (
                    <small>
                      {run?.diagnostic ||
                        result?.data.diagnostic ||
                        slot.missingReason ||
                        slot.waitReason ||
                        "暂无接收端逐秒区间"}
                    </small>
                  )}
                </td>
                <td data-label="平均 Mbps">
                  <strong>
                    {numberText(
                      run?.bitsPerSecond == null
                        ? null
                        : run.bitsPerSecond / 1e6,
                    )}
                  </strong>
                </td>
                <td data-label="最大 Mbps">
                  {numberText(
                    run?.maxBitsPerSecond == null
                      ? null
                      : run.maxBitsPerSecond / 1e6,
                  )}
                </td>
                <td data-label="TCP RTT ms">{numberText(run?.tcpRttMs)}</td>
                <td data-label="发送端重传">{run?.retransmits ?? "—"}</td>
                <td data-label="实际流量">
                  {run?.trafficBytesObserved == null
                    ? "—"
                    : (run.trafficBytesObserved / 1e6).toFixed(1) + " MB"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="report-caption">
        本轮所有方向和连接数组合的已记录应用流量：{(traffic / 1e9).toFixed(3)}{" "}
        GB。协议开销和未确认的失败流量可能未计入。
      </p>
      <p className="report-caption">
        “—”表示没有测量证据。HTTP
        下载端点未提供上传接收器时，上行保持缺测；九格的位置与运营商来自测量端声明或目录来源，并非仅凭
        IP 推断。点击行可检查 IP、实际时长、工具版本、接收端来源和 TCP
        指标采样侧。
      </p>
    </>
  );
}
