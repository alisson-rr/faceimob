import { NAV_ITEMS } from "@/components/layout/navigation";

/**
 * Rota → código de permissão. Fonte única para o menu (`AppSidebar`) e para o
 * guard de rota (`RequireAuth` em `App.tsx`).
 *
 * Esconder o item de menu não protege nada: sem o guard, digitar a URL abre a
 * tela. E se cada um mantivesse sua própria lista, um item some do menu e a URL
 * continua aberta — por isso o mapa é um só.
 *
 * Rota fora deste mapa é liberada para qualquer autenticado (ex.: `/`, redirects
 * internos). O que precisa de permissão precisa estar aqui.
 */
export const ROUTE_PERMISSION: Record<string, string> = {
  "/dashboard": "menu.dashboard",
  "/pipeline": "menu.pipeline",
  "/leads": "menu.leads",
  "/atividades": "menu.atividades",
  "/cca": "menu.cca",
  "/marketing": "menu.marketing",
  "/equipes": "menu.equipes",
  "/links": "menu.links",
  "/gamification": "menu.gamification",
  "/resultados": "menu.resultados",
  "/checkpoint": "menu.checkpoint",
  "/checkin": "menu.checkin",
  "/sdr": "menu.sdr",
  "/data": "menu.data",
  // `/settings` NÃO entra aqui de propósito — ver `firstAllowedRoute`.
  "/admin/permissions": "menu.admin_permissions",
  "/admin/integrations": "menu.admin_integrations",
  "/admin/developers": "menu.admin_developers",
  "/admin/daily-teams": "menu.admin_daily_teams",
  "/admin/allowed-ips": "menu.admin_allowed_ips",
  "/admin/lead-automation": "menu.admin_lead_automation",
  "/admin/meta-ads": "menu.admin_lead_automation",
};

/**
 * Destino guardado pelo guard de sessão (`RequireAuth`, App.tsx) quando barrou
 * um link — lido pelo `/login` e pelo próprio guard do login.
 *
 * Fica aqui, e não dentro de uma das duas telas, porque as DUAS precisam dele:
 * quando a sessão chega no meio do caminho, o guard pode mandar para /login já
 * com o destino no `state`, e é o /login que fecha o percurso. Duas cópias da
 * mesma validação de redirecionamento é como um redirecionamento aberto nasce.
 *
 * Lista branca, não lista negra, e é a MESMA de `INTERNAL_PATH`
 * (`src/lib/notificationLink.ts`): barra inicial que não seja seguida de outra
 * barra nem de contrabarra — `//host` e `\\host` são referências relativas ao
 * protocolo e o navegador resolve as duas para OUTRA origem — e daí só os
 * caracteres que um caminho interno usa.
 *
 * Olhar só os dois primeiros caracteres não basta: tab, CR e LF são REMOVIDOS
 * na análise de URL, então `/<TAB>/host` vira `//host`, exatamente o formato
 * que esta função existe para barrar. Hoje o `state` só é escrito pelo nosso
 * guard (`App.tsx`), com o pathname já normalizado pelo navegador, mas a
 * validação fica na fronteira porque custa uma linha e o erro custaria uma
 * conta.
 *
 * As duas cópias precisam continuar idênticas; unificá-las em um único módulo
 * está registrado como pendência (o dono de `notificationLink.ts` é outra
 * frente e a constante de lá ainda não é exportada).
 */
const INTERNAL_PATH = /^\/(?![/\\])[A-Za-z0-9\-._~/?=&%]*$/;

export const safeRedirect = (state: unknown): string => {
  const from = (state as { from?: unknown } | null)?.from;
  return typeof from === "string" && INTERNAL_PATH.test(from) ? from : "/";
};

export const permissionForPath = (pathname: string): string | undefined => {
  // React Router casa rota ignorando caixa e barra final; sem normalizar aqui,
  // '/Pipeline' ou '/pipeline/' renderizam a tela sem passar pelo guard.
  const normalized = pathname.toLowerCase().replace(/\/+$/, "") || "/";
  return ROUTE_PERMISSION[normalized];
};

/**
 * Primeira rota do menu que o papel realmente abre — o destino de "/" e do
 * pós-login.
 *
 * Antes os dois mandavam para `/dashboard` fixo, mas `menu.dashboard` só é
 * concedido a partner, director, manager e broker (migration 0015): quem é
 * apenas cca, sdr ou marketing entrava e a primeira tela do sistema era o
 * bloco "Acesso não liberado", como se a conta não tivesse sido liberada.
 *
 * Percorre `NAV_ITEMS` na mesma ordem em que a sidebar desenha, então o destino
 * é sempre o primeiro item que o usuário está vendo no menu. Consequência
 * conhecida: o cca ganhou `menu.pipeline` na 0030 e /pipeline vem antes de /cca
 * no menu, então ele entra no Pipeline, não na esteira. É tela permitida e útil
 * para ele (a aba CCA do negócio mora lá); um "home por papel" seria uma
 * segunda fonte de verdade de menu.
 *
 * A decisão de produto (02/09) é levar o cca para /cca, e o jeito de fazer isso
 * SEM segunda fonte de verdade é mover o item `/cca` para antes de `/pipeline`
 * em `NAV_ITEMS` (`src/components/layout/navigation.ts`) — arquivo de outra
 * frente, então a troca está registrada como pendência. Nada muda aqui quando
 * ela acontecer: este arquivo já segue a ordem do menu.
 *
 * O fallback é `/settings`, e por isso `/settings` FICOU DE FORA de
 * `ROUTE_PERMISSION`: um fallback guardado não é fallback. Enquanto a rota
 * exigia `menu.settings`, quem ficasse sem papel nenhum (papel revogado, conta
 * recém-criada antes do trigger) era mandado pelo pós-login para a única tela
 * que o guard também negava — dava "Acesso não liberado" como primeira e única
 * tela do sistema, sem saída. A tela só mexe no próprio perfil e na própria
 * sessão, e quem autoriza é a RLS (`profiles_update_self` + o gatilho
 * `profiles_guard_admin_columns`), não o menu.
 *
 * Consequência assumida — e FECHADA na migration 0072: com a rota livre,
 * `menu.settings` viraria um interruptor morto. A tela de Permissões continuaria
 * oferecendo o controle (e afirmando que ele "vale na barra lateral e no guard
 * da rota"), o admin desmarcaria Configurações para `broker`, a linha gravaria
 * `allowed = false` e o corretor continuaria vendo e abrindo a tela — nenhuma
 * policy consulta o código e a sidebar libera rota sem código. A 0072 apaga a
 * permissão do catálogo, e a linha some sozinha da tela (ela se monta do
 * catálogo). Negar a alguém o acesso à própria senha não é caso de uso real.
 */
export const firstAllowedRoute = (can: (code: string) => boolean): string => {
  const item = NAV_ITEMS.find((nav) => {
    if (nav.hidden) return false;
    const code = permissionForPath(nav.url);
    return !code || can(code);
  });
  return item?.url ?? "/settings";
};
