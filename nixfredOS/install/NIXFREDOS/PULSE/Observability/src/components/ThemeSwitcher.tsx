"use client";

// Omarchy theme switcher (dark themes only: Pulse is a dark cockpit with hard-coded
// light ink, so light themes are left out). Every dark Omarchy theme's colors.toml is baked into
// src/lib/omarchy-themes.json and mapped onto the Pulse design tokens (hex) and
// the shadcn vars (HSL), so a pick recolours every page. [ and ] flip themes.
import { useEffect, useRef, useState } from "react";
import THEMES from "@/lib/omarchy-themes.json";

type Theme = { id: string; name: string; mode: string; sw: string[]; v: Record<string, string> };
const LIST = THEMES as Theme[];
import { THEME_KEY as KEY } from "@/lib/omarchy-theme-prepaint";

function apply(t: Theme) {
  const r = document.documentElement;
  for (const k of Object.keys(LIST[1].v)) r.style.removeProperty(k);
  for (const [k, v] of Object.entries(t.v)) r.style.setProperty(k, v);
  r.dataset.omarchyTheme = t.id;
  r.classList.toggle("dark", t.mode !== "light");
  try { localStorage.setItem(KEY, t.id); } catch {}
}

export default function ThemeSwitcher() {
  const [id, setId] = useState("nixfredos");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let saved = "nixfredos";
    try { saved = localStorage.getItem(KEY) || saved; } catch {}
    setId(LIST.some((t) => t.id === saved) ? saved : "nixfredos");
  }, []);

  const pick = (next: string) => {
    const t = LIST.find((x) => x.id === next) ?? LIST[0];
    apply(t);
    setId(t.id);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key !== "[" && e.key !== "]") return;
      const el = e.target as HTMLElement;
      if (el.closest("input,textarea,[contenteditable=true]")) return;
      const i = LIST.findIndex((t) => t.id === id);
      pick(LIST[(i + (e.key === "]" ? 1 : -1) + LIST.length) % LIST.length].id);
    };
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onClick); };
  }, [id]);

  const cur = LIST.find((t) => t.id === id) ?? LIST[0];

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="Omarchy theme ( [ and ] to flip )"
        className="flex items-center gap-2 px-2.5 py-2 rounded-md text-[12px] tracking-[0.08em] text-ink-2 hover:text-ink-1 transition-colors"
        style={{ border: "1px solid var(--line-2)", fontFamily: "'concourse-t3', sans-serif" }}
      >
        <span className="flex gap-0.5">
          {cur.sw.slice(1).map((c, i) => <i key={i} className="block w-2 h-2 rounded-full" style={{ background: c, boxShadow: `0 0 6px ${c}` }} />)}
        </span>
        <span className="hidden lg:inline">{cur.name}</span>
      </button>
      {open && (
        <div
          className="absolute right-0 top-[calc(100%+8px)] z-[60] p-3 rounded-lg w-[min(540px,calc(100vw-24px))]"
          style={{ background: "var(--surface-1)", border: "1px solid var(--line-2)", boxShadow: "0 20px 60px rgba(0,0,0,.55)" }}
        >
          <p className="text-[11px] tracking-[0.12em] text-ink-3 mb-2">
            OMARCHY THEMES · <kbd className="px-1 border border-line-2 rounded">[</kbd> <kbd className="px-1 border border-line-2 rounded">]</kbd>
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {LIST.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => pick(t.id)}
                className="flex items-center gap-2 px-2.5 py-2 rounded text-left text-[12px] truncate"
                style={{
                  background: t.sw[0],
                  color: t.v["--ink-1"] ?? "var(--ink-1)",
                  border: `1px solid ${t.id === id ? t.sw[1] : "transparent"}`,
                  boxShadow: t.id === id ? `inset 0 0 12px ${t.sw[1]}55` : undefined,
                }}
              >
                <span className="flex gap-px shrink-0">
                  {t.sw.slice(1).map((c, i) => <i key={i} className="block w-1.5 h-4" style={{ background: c }} />)}
                </span>
                <span className="truncate">{t.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
