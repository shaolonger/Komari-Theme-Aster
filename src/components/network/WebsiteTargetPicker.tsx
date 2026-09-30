import { useState } from "react";
import type { NativeCatalog } from "@/services/nativeObservatory";
export function WebsiteTargetPicker({
  catalog,
  value,
  onChange,
}: {
  catalog: NativeCatalog;
  value: string[];
  onChange: (sites: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const entries = catalog.websiteCatalog.length
    ? catalog.websiteCatalog
    : catalog.websites.map((host) => ({
        host,
        name: host,
        group: "网站",
        path: "/",
        provider: "Website",
        reference: "Aster",
      }));
  const groups = [...new Set(entries.map((x) => x.group))];
  function select(sites: string[]) {
    onChange([...new Set(sites)].slice(0, catalog.websiteLimit));
  }
  return (
    <div className="native-site-picker">
      {!catalog.websiteCatalog.length && (
        <p className="network-help">
          当前插件提供旧版目标目录；更新网络观测插件到 v1.6.0 可使用 TcpQuality
          的网站 / API 与 CDN 分组。
        </p>
      )}
      <div className="network-actions">
        <button
          type="button"
          onClick={() => select(catalog.websites.slice(0, 6))}
        >
          推荐 6 项
        </button>
        {catalog.websiteCatalog.length > 0 && (
          <button
            type="button"
            onClick={() =>
              select(
                entries
                  .filter((x) => x.reference === "TcpQuality")
                  .map((x) => x.host),
              )
            }
          >
            TcpQuality 网站与 CDN
          </button>
        )}
        <button
          type="button"
          onClick={() => select(entries.map((x) => x.host))}
        >
          选择全部
        </button>
        <button type="button" onClick={() => select([])}>
          清空
        </button>
      </div>
      <label>
        搜索目标{" "}
        <input
          type="search"
          placeholder="名称、域名或 CDN 提供商"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <small role="status">
        已选 {value.length} 项 · 本方案最多 {catalog.websiteLimit}{" "}
        项。目标依次测量，选择越多耗时越长。
      </small>
      <div className="native-site-picker-list">
        {groups.map((group) => {
          const all = entries.filter((x) => x.group === group);
          const visible = all.filter((x) =>
            `${x.name} ${x.host} ${x.provider}`
              .toLowerCase()
              .includes(search.toLowerCase()),
          );
          if (!visible.length) return null;
          return (
            <section key={group}>
              <div className="native-section-heading">
                <h4>
                  {group} · {all.length}
                </h4>
                <button
                  type="button"
                  onClick={() => select([...value, ...all.map((x) => x.host)])}
                >
                  选择本组
                </button>
              </div>
              <div className="native-check-grid">
                {visible.map((x) => (
                  <label key={x.host}>
                    <input
                      type="checkbox"
                      checked={value.includes(x.host)}
                      disabled={
                        !value.includes(x.host) &&
                        value.length >= catalog.websiteLimit
                      }
                      onChange={() =>
                        select(
                          value.includes(x.host)
                            ? value.filter((v) => v !== x.host)
                            : [...value, x.host],
                        )
                      }
                    />
                    <span className="network-choice-title">
                      <strong>{x.name}</strong>
                      <small>
                        {x.host}
                        {x.provider !== "Website" ? ` · ${x.provider}` : ""}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      {!entries.some((x) =>
        `${x.name} ${x.host} ${x.provider}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ) && <p>没有匹配的目标。</p>}
    </div>
  );
}
