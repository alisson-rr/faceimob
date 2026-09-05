import { describe, expect, it } from "vitest";
import { ROUTE_PERMISSION, firstAllowedRoute, permissionForPath, safeRedirect } from "@/lib/routePermissions";

/**
 * A matriz abaixo é `role_permissions` como está no banco de homologação —
 * conferida por SELECT em 02/09/2026, com as 53 migrations aplicadas, e não
 * copiada de uma migration só. `menu.settings` saiu de todas as linhas: a
 * migration 0072 apagou a permissão do catálogo quando `/settings` virou o
 * fallback livre do pós-login.
 *
 * Ela estava DEFASADA e o teste tinha deixado de ser sentinela: dizia que
 * broker/cca/sdr tinham `menu.data` (a 0045 tirou) e que broker não tinha
 * `menu.atividades` (a 0036 deu). Os destinos não mudaram, mas um teste que
 * descreve um banco que não existe passa em qualquer cenário — inclusive no de
 * uma concessão sumir sem ninguém notar.
 *
 * Os sete papéis não-admin entram aqui de propósito: o destino do pós-login é a
 * primeira tela que a pessoa vê do sistema, e quatro deles (cca, sdr, marketing,
 * e qualquer um que perca `menu.dashboard`) não tinham cobertura nenhuma.
 */
const MATRIZ: Record<string, string[]> = {
  partner: [
    "menu.admin_allowed_ips", "menu.atividades", "menu.checkin", "menu.checkpoint",
    "menu.dashboard", "menu.data", "menu.equipes", "menu.gamification", "menu.leads",
    "menu.links", "menu.marketing", "menu.pipeline", "menu.resultados", "menu.sdr",
  ],
  director: [
    "menu.atividades", "menu.checkin", "menu.checkpoint", "menu.dashboard", "menu.data",
    "menu.equipes", "menu.gamification", "menu.leads", "menu.links", "menu.marketing",
    "menu.pipeline", "menu.resultados", "menu.sdr",
  ],
  manager: [
    "menu.atividades", "menu.checkin", "menu.checkpoint", "menu.dashboard", "menu.data",
    "menu.equipes", "menu.gamification", "menu.leads", "menu.links", "menu.marketing",
    "menu.pipeline", "menu.resultados", "menu.sdr",
  ],
  broker: [
    "menu.atividades", "menu.checkin", "menu.dashboard", "menu.equipes",
    "menu.gamification", "menu.leads", "menu.links", "menu.pipeline",
  ],
  cca: ["menu.cca", "menu.equipes", "menu.pipeline"],
  sdr: ["menu.leads", "menu.sdr"],
  marketing: ["menu.data", "menu.marketing", "menu.resultados"],
};

const canDe = (codes: string[]) => (code: string) => codes.includes(code);

describe("firstAllowedRoute", () => {
  it("leva ao dashboard quem tem `menu.dashboard`", () => {
    for (const papel of ["partner", "director", "manager", "broker"]) {
      expect(firstAllowedRoute(canDe(MATRIZ[papel])), papel).toBe("/dashboard");
    }
  });

  it("leva cca, sdr e marketing à primeira tela que cada um abre", () => {
    // O defeito original: os três caíam em /dashboard e viam "Acesso não
    // liberado" como primeira tela do sistema.
    //
    // cca cai em /pipeline, não em /cca: o destino segue a ordem do menu e
    // /pipeline vem antes. É tela permitida e funcional para ele (a aba CCA do
    // negócio). A troca combinada é mover `/cca` para antes de `/pipeline` em
    // NAV_ITEMS — quando isso acontecer, este `toBe` é a linha que muda, e é
    // aqui que se vê que a mudança valeu.
    expect(firstAllowedRoute(canDe(MATRIZ.cca))).toBe("/pipeline");
    expect(firstAllowedRoute(canDe(MATRIZ.sdr))).toBe("/leads");
    expect(firstAllowedRoute(canDe(MATRIZ.marketing))).toBe("/marketing");
  });

  it("leva admin ao dashboard — `can` responde sim para tudo", () => {
    expect(firstAllowedRoute(() => true)).toBe("/dashboard");
  });

  it("cai em /settings quando nenhum item do menu é permitido", () => {
    expect(firstAllowedRoute(() => false)).toBe("/settings");
  });

  it("o fallback /settings não é guardado — senão não seria fallback", () => {
    // Enquanto `/settings` exigia `menu.settings`, quem ficasse sem papel
    // nenhum era mandado pelo pós-login para a única tela que o guard também
    // negava: "Acesso não liberado" como primeira e única tela, sem saída.
    expect(permissionForPath("/settings")).toBeUndefined();
  });

  it("nenhuma rota do mapa aponta para um código que saiu do catálogo", () => {
    // `menu.settings` foi apagado do catálogo pela migration 0072 justamente
    // porque a rota deixou de consultá-lo: um código no mapa sem policy que o
    // use vira interruptor morto na tela de Permissões. O outro lado deste
    // par está em `supabase/tests/72_entrada_sino.sql`.
    expect(Object.values(ROUTE_PERMISSION)).not.toContain("menu.settings");
  });

  it("o destino escolhido passa pelo guard de rota", () => {
    // Mesma conta do `RequirePermission` (App.tsx): rota sem código é liberada
    // a qualquer autenticado; rota com código exige a concessão. Sem isto, um
    // destino guardado que o papel não abre pareceria válido.
    const passaNoGuard = (destino: string, codes: string[]) => {
      const code = permissionForPath(destino);
      return !code || codes.includes(code);
    };

    for (const [papel, codes] of Object.entries(MATRIZ)) {
      const destino = firstAllowedRoute(canDe(codes));
      expect(passaNoGuard(destino, codes), `${papel} → ${destino}`).toBe(true);
    }
    // E o caso que motivou tudo: papel nenhum.
    expect(passaNoGuard(firstAllowedRoute(() => false), []), "sem papel").toBe(true);
  });
});

/**
 * `safeRedirect` decide para onde o login volta. É uma função de
 * redirecionamento: os três formatos que enganam validação ingênua têm de cair
 * na home, não em outra origem.
 */
describe("safeRedirect", () => {
  it("devolve o caminho interno que o guard guardou", () => {
    expect(safeRedirect({ from: "/pipeline" })).toBe("/pipeline");
    expect(safeRedirect({ from: "/leads?lead=abc" })).toBe("/leads?lead=abc");
  });

  it("cai na home sem state, com state estranho ou sem `from`", () => {
    expect(safeRedirect(null)).toBe("/");
    expect(safeRedirect(undefined)).toBe("/");
    expect(safeRedirect({})).toBe("/");
    expect(safeRedirect("/pipeline")).toBe("/");
    expect(safeRedirect({ from: 42 })).toBe("/");
  });

  it("recusa destino que sai da origem", () => {
    // `//host` e `\\host` são referências relativas ao protocolo: o navegador
    // resolve as duas para outra origem.
    expect(safeRedirect({ from: "//evil.example" })).toBe("/");
    expect(safeRedirect({ from: "/\\evil.example" })).toBe("/");
    expect(safeRedirect({ from: "https://evil.example" })).toBe("/");
    expect(safeRedirect({ from: "javascript:alert(1)" })).toBe("/");
    expect(safeRedirect({ from: "pipeline" })).toBe("/");
  });

  it("recusa caractere de controle e espaço — tab/CR viram `//host` na URL", () => {
    // Tab, CR e LF são REMOVIDOS na análise de URL do navegador: "/<TAB>/host"
    // vira "//host", o formato que a validação existe para barrar. Uma versão
    // que só olhava os dois primeiros caracteres aceitava os três.
    expect(safeRedirect({ from: "/\t/evil.example" })).toBe("/");
    expect(safeRedirect({ from: "/\r/evil" })).toBe("/");
    expect(safeRedirect({ from: "/\n/evil" })).toBe("/");
    expect(safeRedirect({ from: "/ evil" })).toBe("/");
  });
});
