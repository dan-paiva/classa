import { useEffect } from "react";
import type { SchoolSettings } from "../api-school.ts";

type Theme = NonNullable<SchoolSettings["theme"]>;

/** O que cada tema troca além das cores de `[data-theme]` no index.css. */
const THEMES: Record<Theme, { logo: string; favicon: string; font: string }> = {
  alumni: {
    logo: "/temas/alumni/logo.png",
    favicon: "/temas/alumni/favicon.png",
    font: "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&display=swap",
  },
};

export function themeOf(theme: SchoolSettings["theme"] | undefined) {
  return theme ? THEMES[theme] : null;
}

/** Fonte e ícone da aba da escola enquanto ela está aberta; ao sair, volta o do Classa. */
export function useThemeAssets(theme: SchoolSettings["theme"] | undefined) {
  useEffect(() => {
    const t = themeOf(theme);
    if (!t) return;
    const font = document.createElement("link");
    font.rel = "stylesheet";
    font.href = t.font;
    document.head.append(font);
    const icon = document.querySelector<HTMLLinkElement>("link[rel=icon]");
    const before = icon ? { href: icon.href, type: icon.type } : null;
    if (icon) Object.assign(icon, { href: t.favicon, type: "image/png" });
    return () => {
      font.remove();
      if (icon && before) Object.assign(icon, before);
    };
  }, [theme]);
}
