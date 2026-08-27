/** Destino quando o `link` da notificação não é um caminho interno. */
const SAFE_LINK = "/dashboard";

/**
 * Lista branca, não lista negra: barra inicial que não é seguida de outra barra
 * nem de contrabarra, e daí só os caracteres que um caminho interno usa. Recusa
 * de uma vez os três formatos que enganam validação ingênua — `//host` e
 * `\\host` (referências relativas ao protocolo: o navegador resolve as duas
 * para outra origem) e `https://host` — mais `javascript:`, espaço e caractere
 * de controle: tab, CR e LF são removidos na análise de URL, então `/<TAB>/host`
 * viraria `//host`.
 */
const INTERNAL_PATH = /^\/(?![/\\])[A-Za-z0-9\-._~/?=&%]*$/;

/**
 * Destino de uma notificação do sino.
 *
 * `notify_lead_assigned` (migration `0011`) grava `link='/leads/<id>'` e essa
 * rota não existe: o clique mais importante do corretor caía no 404. Aqui o
 * link vira `/leads?lead=<id>`, que a tela de Leads abre no modal do lead.
 * Corrigir na origem é uma migration de uma linha, ainda pendente.
 *
 * O `link` vem da coluna `notifications.link`, e a policy `notifications_insert`
 * só cobra papel (`admin`/`director`/`manager`) — não restringe `profile_id` nem
 * o conteúdo do link. Hoje só os triggers das migrations escrevem ali, montando
 * o caminho a partir de ids, mas quem tem o papel pode gravar o destino que
 * quiser no sino de qualquer perfil. Por isso só caminho interno vira
 * `navigate`; o resto vai para `SAFE_LINK`.
 *
 * Mora em `src/lib/` — e não dentro do `NotificationBell` — porque é função
 * pura de destino: aqui ela não precisa do `eslint-disable` de
 * `react-refresh/only-export-components` nem de um `vi.mock` do cliente
 * Supabase para o teste conseguir importá-la (handoff-M §3).
 */
export function resolveLink(link: string): string {
  if (!INTERNAL_PATH.test(link)) return SAFE_LINK;
  return link.replace(/^\/leads\/([0-9a-fA-F-]{36})$/, "/leads?lead=$1");
}
