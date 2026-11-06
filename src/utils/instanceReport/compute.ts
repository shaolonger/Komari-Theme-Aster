import type { ReportInput, ReportModel } from "./model";
import { throwIfReportAborted } from "./model";
import { buildReport } from "./aggregate";

export function computeReport(
  input: ReportInput,
  signal: AbortSignal,
  progress?: (text: string) => void,
): Promise<ReportModel> {
  throwIfReportAborted(signal);
  return new Promise((resolve, reject) => {
    let worker: Worker | undefined;
    let state: "worker" | "compatible" | "finished" = "worker";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stopWorker = () => {
      if (!worker) return;
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      worker.terminate();
      worker = undefined;
    };
    const clean = () => {
      state = "finished";
      stopWorker();
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      clean();
      reject(signal.reason ?? new DOMException("已取消", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    // Use the identical calculation on the already collected input. No new
    // requests, worker policy changes or altered statistics are needed.
    const compatible = () => {
      if (state !== "worker") return;
      state = "compatible";
      stopWorker();
      progress?.("后台计算不可用，正在以兼容模式整理已读取的历史数据…");
      // Yield so progress can render and cancellation can run before computing.
      timer = setTimeout(() => {
        try {
          throwIfReportAborted(signal);
          const model = buildReport(input);
          throwIfReportAborted(signal);
          clean();
          resolve(model);
        } catch (error) {
          clean();
          reject(error);
        }
      }, 0);
    };
    try {
      worker = new Worker(
        new URL("../../workers/instanceReport.worker.ts", import.meta.url),
        { type: "module" },
      );
    } catch {
      compatible();
      return;
    }
    worker.onmessage = (
      event: MessageEvent<{ model?: ReportModel; error?: string }>,
    ) => {
      if (state !== "worker") return;
      clean();
      if (event.data.model) resolve(event.data.model);
      else reject(new Error(event.data.error || "报告计算失败"));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      compatible();
    };
    worker.onmessageerror = compatible;
    try {
      worker.postMessage(input);
    } catch (error) {
      clean();
      reject(error);
    }
  });
}
