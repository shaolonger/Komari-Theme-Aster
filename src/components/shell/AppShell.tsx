import { isCupertinoAppearance } from "@/utils/themeSettings";
import { Outlet } from "react-router-dom";
import { BackgroundLayer } from "./BackgroundLayer";
import { FloatingControls } from "./FloatingControls";
import { useSiteMetadata } from "@/hooks/useSiteMetadata";
import { lazy, Suspense } from "react";
import { usePreferences } from "@/hooks/usePreferences";
const CupertinoShell = lazy(() => import("./CupertinoShell"));
const LuminousShell = lazy(() => import("./LuminousShell"));

export function AppShell() {
  useSiteMetadata();
  const { appearance } = usePreferences();
  return (
    <div className="app-shell relative flex min-h-screen flex-col">
      <BackgroundLayer />
      {appearance === "luminous" && <Suspense fallback={null}><LuminousShell /></Suspense>}
      {isCupertinoAppearance(appearance) && <Suspense fallback={null}><CupertinoShell /></Suspense>}
      <FloatingControls />
      {/* max-[720px]:pt-16 给右上角固定的浮动控件留出空间，避免窄屏下展开的控件行盖住首张卡片的头部 */}
      <main className="app-main flex-1 px-3 pb-8 pt-5 max-[720px]:pt-16 sm:px-5 md:px-6 lg:px-8 lg:pt-6">
        <div className="mx-auto w-full max-w-[1720px]">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
