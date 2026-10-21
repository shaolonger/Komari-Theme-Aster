import {
  Activity,
  LayoutGrid,
  List,
  Monitor,
  Rows3,
  Settings,
  SlidersHorizontal,
  Sun,
  Moon,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router-dom";
import { usePreferences } from "@/hooks/usePreferences";
import { useViewMode } from "@/hooks/useViewMode";
import { useAuth } from "@/hooks/useAuth";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { clsx } from "clsx";

const APPEARANCE_OPTIONS = [
  { value: "light", icon: Sun, label: "浅色" },
  { value: "system", icon: Monitor, label: "跟随系统" },
  { value: "dark", icon: Moon, label: "深色" },
  { value: "diagnostic", icon: Activity, label: "诊断" },
  { value: "clearsky", icon: Sparkles, label: "澄空" },
] as const;

const VIEW_OPTIONS = [
  { value: "large", icon: LayoutGrid, label: "扩展卡片" },
  { value: "standard", icon: Monitor, label: "标准卡片" },
  { value: "compact", icon: Rows3, label: "紧凑卡片" },
  { value: "list", icon: List, label: "列表" },
] as const;

export default function FloatingControlsMenu({ hidden }: { hidden: boolean }) {
  const { appearance, setAppearance } = usePreferences();
  const { mode, setMode } = useViewMode();
  const { data: me } = useAuth();
  const themeSettings = useThemeSettings();
  const settingsReady = themeSettings.isReady;
  const showAdmin = settingsReady && themeSettings.enableAdminButton;
  const showThemeManage = Boolean(me?.logged_in);
  const hiddenTabIndex = hidden ? -1 : undefined;
  return (
    <>
      {(showThemeManage || showAdmin) && (
        <div className="floating-controls-shortcuts">
          {showThemeManage && (
            <Link
              to="/?view=theme-manage"
              aria-label="主题设置"
              title="主题设置"
              tabIndex={hiddenTabIndex}
              className="control-button grid h-9 w-9 place-items-center"
            >
              <SlidersHorizontal size={16} />
            </Link>
          )}
          {showAdmin && (
            <a
              href="/admin"
              aria-label={me?.logged_in ? "管理" : "后台登录"}
              title={me?.logged_in ? "管理" : "后台登录"}
              tabIndex={hiddenTabIndex}
              className="control-button grid h-9 w-9 place-items-center"
            >
              <Settings size={16} />
            </a>
          )}
        </div>
      )}
      {settingsReady && (
        <div className="floating-controls-preferences">
          <div className="control-group" role="group" aria-label="外观选择">
            {APPEARANCE_OPTIONS.map(({ value, icon: Icon, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setAppearance(value)}
                aria-label={label}
                aria-pressed={appearance === value}
                title={label}
                tabIndex={hiddenTabIndex}
                className={clsx(
                  "control-button control-toggle grid h-9 w-9 place-items-center",
                  appearance === value && "is-active",
                )}
              >
                <Icon size={16} />
              </button>
            ))}
          </div>
          <div className="control-group" role="group" aria-label="节点视图">
            {VIEW_OPTIONS.map(({ value, icon: Icon, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                aria-label={label}
                aria-pressed={mode === value}
                title={`临时切换到${label}`}
                tabIndex={hiddenTabIndex}
                className={clsx(
                  "control-button control-toggle grid h-9 w-9 place-items-center",
                  mode === value && "is-active",
                )}
              >
                <Icon size={16} />
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
