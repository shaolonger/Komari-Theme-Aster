import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Search, X } from "lucide-react";
import { matchesNodeSearch, readNodeSearchInput, splitNodeSearchGroups, writeNodeSearchInput } from "@/utils/nodeSearch";
import "@/styles/luminous-search.css";

export default function LuminousSearch({ value, onChange, texts, resultCount = 0, hasFilters = false, inputRef }: {
  value: string;
  onChange: (value: string) => void;
  texts?: ReadonlyMap<string, string>;
  resultCount?: number;
  hasFilters?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const localInput = useRef<HTMLInputElement>(null);
  const input = inputRef ?? localInput;
  const root = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const selectAfterEdit = useRef(false);
  const [compositionDraft, setCompositionDraft] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(1);
  const panelId = useId();
  const { tokens, draft } = readNodeSearchInput(value);
  useLayoutEffect(() => {
    if (!selectAfterEdit.current) return;
    selectAfterEdit.current = false;
    input.current?.focus();
    input.current?.select();
  }, [value, input]);
  const groups = useMemo(() => splitNodeSearchGroups(value), [value]);
  const stats = useMemo(() => {
    const counts = new Map(groups.map(group => [group, 0]));
    let total = 0;
    for (const text of texts?.values() ?? []) {
      let matched = false;
      for (const group of groups) {
        if (!matchesNodeSearch(group, text)) continue;
        counts.set(group, (counts.get(group) ?? 0) + 1);
        matched = true;
      }
      if (matched) total++;
    }
    return { counts, total };
  }, [groups, texts]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", key);
    const observer = new ResizeObserver(([entry]) => setVisibleCount(entry.contentRect.width >= 520 ? 2 : 1));
    if (root.current) observer.observe(root.current);
    return () => { window.removeEventListener("keydown", key); observer.disconnect(); };
  }, [input]);
  const updateDraft = (next: string, commit = false) => {
    const parsed = readNodeSearchInput(writeNodeSearchInput(tokens, next));
    onChange(commit
      ? writeNodeSearchInput([...parsed.tokens, parsed.draft])
      : writeNodeSearchInput(parsed.tokens, parsed.draft));
    setSelected(null);
  };
  const remove = (token: string) => {
    onChange(writeNodeSearchInput(tokens.filter(item => item !== token), draft));
    setSelected(null);
    input.current?.focus();
  };
  const edit = (token: string) => {
    selectAfterEdit.current = true;
    onChange(writeNodeSearchInput([...tokens.filter(item => item !== token), draft], token));
    setSelected(null);
  };
  const chip = (token: string, inPanel = false) => (
    <span className="luminous-search-chip" key={token} data-unmatched={stats.counts.get(token) === 0} data-selected={selected === token}>
      <button type="button" onClick={() => edit(token)} aria-label={`修改搜索条件 ${token}`} title={token}>
        {token}{inPanel && <small>{stats.counts.get(token) ?? 0} 台</small>}
      </button>
      <button type="button" onClick={() => remove(token)} aria-label={`删除搜索条件 ${token}`}><X size={11} /></button>
    </span>
  );
  const hasQuery = groups.length > 0;
  const open = focused || expanded;
  return (
    <div className="luminous-home-search" data-has-query={hasQuery} ref={root}
      onFocus={() => setFocused(true)}
      onKeyDown={event => {
        if (event.key !== "Escape" || composing.current || event.nativeEvent.isComposing) return;
        setFocused(false); setExpanded(false); setSelected(null);
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      }}
      onBlur={event => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        setFocused(false); setExpanded(false); setSelected(null);
      }}>
      <div className="luminous-search" role="search" aria-label="多条件 VPS 搜索">
        <Search size={17} aria-hidden="true" />
        {tokens.slice(0, visibleCount).map(token => chip(token))}
        {tokens.length > visibleCount && <button type="button" className="luminous-search-more" aria-label={`展开全部 ${tokens.length} 项搜索条件`} aria-expanded={open} aria-controls={panelId} onClick={() => setExpanded(true)}>+{tokens.length - visibleCount}</button>}
        <input ref={input} type="text" enterKeyHint="search" aria-label="搜索 VPS" autoComplete="off" spellCheck={false}
          aria-describedby={open ? panelId : undefined}
          placeholder={tokens.length ? "继续添加…" : "名称、IP、标签；逗号搜索多台…"}
          value={compositionDraft ?? draft}
          onChange={event => {
            if (composing.current) setCompositionDraft(event.target.value);
            else updateDraft(event.target.value);
          }}
          onCompositionStart={() => { composing.current = true; setCompositionDraft(draft); }}
          onCompositionEnd={event => { composing.current = false; setCompositionDraft(null); updateDraft(event.currentTarget.value); }}
          onPaste={event => {
            const text = event.clipboardData.getData("text");
            if (composing.current || !/[,，\r\n]/u.test(text)) return;
            event.preventDefault();
            const field = event.currentTarget;
            updateDraft(draft.slice(0, field.selectionStart ?? draft.length) + text + draft.slice(field.selectionEnd ?? draft.length), true);
          }}
          onKeyDown={event => {
            if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "Enter") {
              event.preventDefault(); updateDraft(draft, true);
            } else if (event.key === "Backspace" && !draft && tokens.length) {
              event.preventDefault();
              if (selected) remove(selected); else setSelected(tokens.at(-1) ?? null);
            } else if (event.key === "Escape") {
              event.preventDefault(); input.current?.blur();
            } else setSelected(null);
          }} />
        {hasQuery ? <>
          <span className="luminous-search-count" role="status" aria-live="polite" aria-atomic="true" title={hasFilters ? "当前筛选下匹配的 VPS" : "匹配的 VPS"}>{resultCount} 台</span>
          <button type="button" className="luminous-search-clear" aria-label="清空 VPS 搜索" onClick={() => { onChange(""); setSelected(null); input.current?.focus(); }}><X size={14} /></button>
        </> : <kbd aria-hidden="true">⌘ K</kbd>}
      </div>
      {open && <div className="luminous-search-panel" id={panelId}>
        {hasQuery && <p className="luminous-search-result">
          匹配任一条件 · {hasFilters ? "当前筛选下" : "找到"} <strong>{resultCount}</strong> 台
          {hasFilters && stats.total > resultCount && <span>，另有 {stats.total - resultCount} 台被筛选隐藏</span>}
        </p>}
        {tokens.length > 0 && <div className="luminous-search-all">{tokens.map(token => chip(token, true))}</div>}
        {hasQuery && stats.total === 0 && <p className="luminous-search-warning">没有匹配的 VPS，请检查名称或 IP；点击标签可修改。</p>}
        <p>逗号 / 换行添加条件，匹配任意一项；空格要求同时满足。</p>
        <p>例如 <code>hk mini, jp taxi</code> · 支持粘贴多行名称或 IP，回车确认标签。</p>
      </div>}
    </div>
  );
}
