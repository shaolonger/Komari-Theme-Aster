import { buildReport } from "@/utils/instanceReport/aggregate";
import type { ReportInput } from "@/utils/instanceReport/model";

self.onmessage = (event: MessageEvent<ReportInput>) => {
  try {
    self.postMessage({ model: buildReport(event.data) });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : "报告计算失败",
    });
  }
};
