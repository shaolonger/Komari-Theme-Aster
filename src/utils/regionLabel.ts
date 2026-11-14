import { getDisplayRegionCode } from "@/utils/geo";

const names = new Intl.DisplayNames(["zh-CN"], { type: "region" });
export function regionLabel(region: string | null | undefined) {
  const value = region?.trim() ?? "";
  const code = getDisplayRegionCode(value);
  return code === "UN" ? value || "未设置地区" : names.of(code) || value;
}
