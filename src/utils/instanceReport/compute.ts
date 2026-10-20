import type { ReportInput, ReportModel } from "./model";
import { throwIfReportAborted } from "./model";

export function computeReport(
  input: ReportInput,
  signal: AbortSignal,
): Promise<ReportModel> {
  throwIfReportAborted(signal);
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("../../workers/instanceReport.worker.ts", import.meta.url),
      { type: "module" },
    );
    const clean = () => {
      worker.terminate();
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      clean();
      reject(signal.reason ?? new DOMException("已取消", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (
      event: MessageEvent<{ model?: ReportModel; error?: string }>,
    ) => {
      clean();
      if (event.data.model) resolve(event.data.model);
      else reject(new Error(event.data.error || "报告计算失败"));
    };
    worker.onerror = () => {
      clean();
      reject(
        new Error(
          "报告计算进程启动失败，请检查浏览器支持与站点的内容安全策略。",
        ),
      );
    };
    try {
      worker.postMessage(input);
    } catch (error) {
      clean();
      reject(error);
    }
  });
}
