import { cn } from "@/lib/utils";

/*
 * ============================================================================
 * FALTA UM ARQUIVO — leia antes de mexer aqui.
 * ============================================================================
 * `logo-faceimob.png` e `logo-faceimob-white.png` sao o MESMO arquivo (md5
 * 0526dd31…), e o mesmo vale para os dois simbolos (md5 0d34954c…). Os nomes
 * mentem: as duas artes tem a palavra "faceimob" em BRANCO. Nao existe versao
 * com a letra escura no repositorio — e "LOGOTIPO + Texto.png", que o cliente
 * subiu em `public/`, e byte a byte o `logo-faceimob.png` que ja estava aqui
 * (conferido em 10/09/2026), entao tambem nao resolve.
 *
 * O QUE PEDIR A MARCA: o lockup (simbolo + palavra "faceimob") com a letra
 *   ESCURA e FUNDO TRANSPARENTE — SVG de preferencia, ou PNG @2x.
 * ONDE COLOCAR: `src/assets/logo-faceimob-dark.png` (ou `.svg`).
 * O QUE MUDAR: a linha do import `lockupOnLight` logo abaixo. So ela.
 *   Se vier tambem o simbolo com letra escura, idem para `symbolOnLight`.
 *
 * Enquanto isso, `*OnLight` aponta para a arte de letra branca e o lockup fica
 * com contraste ruim sobre superficie clara. E defeito conhecido e assumido:
 * filtro CSS, sombra, contorno ou placa colorida atras da logo alterariam a
 * identidade visual da marca por conta propria, o que ninguem pediu.
 * ponytail: sem asset de letra escura; resolver quando o arquivo chegar.
 */
import lockupOnDark from "@/assets/logo-faceimob-white.png";
import lockupOnLight from "@/assets/logo-faceimob.png";
import symbolOnDark from "@/assets/logo-faceimob-symbol-white.png";
import symbolOnLight from "@/assets/logo-faceimob-symbol.png";

const ART = {
  /** Simbolo + palavra "faceimob". */
  lockup: { onDark: lockupOnDark, onLight: lockupOnLight },
  /** So o simbolo, quadrado. */
  symbol: { onDark: symbolOnDark, onLight: symbolOnLight },
} as const;

export type LogoProps = {
  variant?: keyof typeof ART;
  /**
   * Superficie escura em QUALQUER tema — o painel `bg-brand-blue` do Login.
   * Sem isso a troca segue o tema do app.
   */
  onDark?: boolean;
  /** Classes de tamanho e posicao. Nao passe `hidden`/`lg:hidden` aqui: use um wrapper. */
  className?: string;
  /** `""` marca a imagem como decorativa (o nome ja esta em um titulo perto). */
  alt?: string;
};

/**
 * Ponto unico da marca: nenhuma tela deve importar `@/assets/logo-*` direto.
 *
 * A troca por tema e CSS, nao JS, porque `useTheme()` guarda um `useState` por
 * componente — dois componentes = dois estados independentes, e o que nao
 * chamou `toggleTheme` fica com o valor do mount. A classe `.light` que o
 * `main.tsx` poe no `<html>` e a unica fonte de verdade, e ela acerta tambem no
 * primeiro paint. As duas <img> convivem no DOM; `display:none` tira a escondida
 * do fluxo E da arvore de acessibilidade, entao so uma anuncia o nome por vez.
 */
export function Logo({ variant = "lockup", onDark = false, className, alt = "Faceimob" }: LogoProps) {
  const art = ART[variant];
  const img = (src: string, swap: string) => (
    <img
      src={src}
      alt={alt}
      aria-hidden={alt === "" || undefined}
      className={cn("object-contain", className, swap)}
    />
  );

  if (onDark) return img(art.onDark, "");

  return (
    <>
      {img(art.onDark, "[.light_&]:hidden")}
      {img(art.onLight, "hidden [.light_&]:block")}
    </>
  );
}
