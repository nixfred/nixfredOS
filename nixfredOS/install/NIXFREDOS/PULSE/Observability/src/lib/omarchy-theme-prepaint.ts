// Server-safe: builds the inline <head> script that applies the saved Omarchy
// theme before first paint (no flash). The UI lives in components/ThemeSwitcher.
import THEMES from "@/lib/omarchy-themes.json";

export const THEME_KEY = "pulse-omarchy-theme";

export function themePrepaintScript(): string {
  const map = Object.fromEntries((THEMES as { id: string; mode: string; v: Record<string, string> }[]).map((t) => [t.id, { v: t.v, light: t.mode === "light" }]));
  return `(function(){try{var m=${JSON.stringify(map)};var id=localStorage.getItem("${THEME_KEY}");var t=id&&m[id];if(!t)return;var r=document.documentElement;for(var k in t.v)r.style.setProperty(k,t.v[k]);r.dataset.omarchyTheme=id;if(t.light)r.classList.remove("dark");}catch(e){}})();`;
}
