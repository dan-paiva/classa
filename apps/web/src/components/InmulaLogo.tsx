/**
 * Logo da Inmula by Bigger, no espírito do da Alumni: "in" fino e "mula" grosso,
 * barra vermelha e o "by" pequeno embaixo. Branco, para o menu escuro; a fonte é a
 * Manrope que o tema já carrega.
 */
export function InmulaLogo({ title }: { title: string }) {
  return (
    <svg viewBox="0 0 200 64" role="img" aria-label={title} className="theme-logo">
      <title>{title}</title>
      <text x="0" y="38" fill="#fff" fontFamily="Manrope, system-ui, sans-serif" fontSize="44" letterSpacing="-1.5" textLength="196" lengthAdjust="spacingAndGlyphs">
        <tspan fontWeight="300">in</tspan>
        <tspan fontWeight="800">mula</tspan>
      </text>
      <rect x="1" y="45" width="196" height="4.5" fill="#e30613" />
      <text x="197" y="62" fill="#fff" textAnchor="end" fontFamily="Manrope, system-ui, sans-serif">
        <tspan fontSize="9" fontWeight="500">by </tspan>
        <tspan fontSize="11.5" fontWeight="800" letterSpacing="2.2">BIGGER</tspan>
      </text>
    </svg>
  );
}
