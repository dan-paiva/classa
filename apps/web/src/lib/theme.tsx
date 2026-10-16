import { useEffect, type ReactNode } from "react";
import { InmulaLogo } from "../components/InmulaLogo.tsx";
import type { SchoolSettings } from "../api-school.ts";

type Theme = NonNullable<SchoolSettings["theme"]>;

const MANROPE = "https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&display=swap";

/**
 * O que cada tema troca além das cores de `[data-theme]` no index.css. O logo é uma
 * imagem (`logo`) ou desenhado na página (`Logo`), quando precisa da fonte do tema.
 */
const THEMES: Record<Theme, { logo?: string; Logo?: (p: { title: string }) => ReactNode; favicon: string; faviconType: string; font: string }> = {
  alumni: { logo: "/temas/alumni/logo.png", favicon: "/temas/alumni/favicon.png", faviconType: "image/png", font: MANROPE },
  // a escola fictícia das demonstrações: as cores da Alumni, com nome e logo próprios
  inmula: { Logo: InmulaLogo, favicon: "/temas/inmula/favicon.svg", faviconType: "image/svg+xml", font: MANROPE },
};

/** O logo do tema no topo do menu. */
export function ThemeLogo({ theme, title }: { theme: Theme; title: string }) {
  const t = THEMES[theme];
  return t.Logo ? <t.Logo title={title} /> : <img src={t.logo} alt={title} />;
}

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
    if (icon) Object.assign(icon, { href: t.favicon, type: t.faviconType });
    return () => {
      font.remove();
      if (icon && before) Object.assign(icon, before);
    };
  }, [theme]);
}
