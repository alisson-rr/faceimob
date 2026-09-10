import {
  Bot, Building2, CalendarClock, CreditCard, Database, GitBranch, Globe, KeyRound, LayoutDashboard,
  LogIn, Megaphone, Settings, Shield, Target, TrendingUp, Trophy, UserSearch, Users, Zap,
  type LucideIcon,
} from "lucide-react";

export type NavGroup = "principal" | "configuracoes";

export interface NavItem {
  title: string;
  url: string;
  icon: LucideIcon;
  group: NavGroup;
  /** Rota real que nao aparece no menu (chega por link de outra tela). */
  hidden?: boolean;
}

/**
 * Fonte unica da navegacao: o menu lateral (`AppSidebar`) E o rotulo da barra
 * do topo (`AppLayout`) saem daqui. Antes eram dois mapas, e o do topo cobria
 * 12 das 27 rotas — Check-in, Gamificacao, Checkpoint, SDR e todo o admin
 * apareciam como "Faceimob".
 *
 * A visibilidade continua saindo da matriz `role_permissions` (migration 0015)
 * via `ROUTE_PERMISSION`, o mesmo mapa do guard de rota — item somindo do menu
 * com a URL aberta seria pior que nada.
 */
export const NAV_ITEMS: NavItem[] = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, group: "principal" },
  { title: "Pipeline", url: "/pipeline", icon: GitBranch, group: "principal" },
  { title: "Leads", url: "/leads", icon: UserSearch, group: "principal" },
  { title: "Atividades", url: "/atividades", icon: CalendarClock, group: "principal" },
  { title: "Esteira CCA", url: "/cca", icon: CreditCard, group: "principal" },
  { title: "Marketing", url: "/marketing", icon: Megaphone, group: "principal" },
  { title: "Equipes", url: "/equipes", icon: Users, group: "principal" },
  { title: "Gamificação", url: "/gamification", icon: Trophy, group: "principal" },
  { title: "Checkpoint", url: "/checkpoint", icon: Target, group: "principal" },
  { title: "Check-in", url: "/checkin", icon: LogIn, group: "principal" },
  { title: "SDR IA", url: "/sdr", icon: Bot, group: "principal" },

  { title: "Configurações", url: "/settings", icon: Settings, group: "configuracoes" },
  { title: "Resultados", url: "/resultados", icon: TrendingUp, group: "configuracoes" },
  { title: "Permissões", url: "/admin/permissions", icon: Shield, group: "configuracoes" },
  { title: "Integrações", url: "/admin/integrations", icon: KeyRound, group: "configuracoes" },
  { title: "Construtoras", url: "/admin/developers", icon: Building2, group: "configuracoes" },
  { title: "Diário — Links", url: "/admin/daily-teams", icon: KeyRound, group: "configuracoes" },
  { title: "IPs autorizados", url: "/admin/allowed-ips", icon: Globe, group: "configuracoes" },
  { title: "Automação Leads", url: "/admin/lead-automation", icon: Zap, group: "configuracoes" },
  { title: "Meta Ads", url: "/admin/meta-ads", icon: Megaphone, group: "configuracoes" },
  { title: "Dados", url: "/data", icon: Database, group: "configuracoes" },
];

/**
 * Dois grupos, não quatro.
 *
 * O menu principal tinha treze itens, com Links e Resultados no meio do caminho
 * de quem trabalha, e ainda existiam "Administração" e "Sistema" separados —
 * sem critério que dissesse de qual dos dois era "Dados". Pedido do cliente em
 * 05/09/2026: tudo que é configuração no MESMO menu. O que fica em "principal"
 * é o que se usa para trabalhar; o resto é ajuste, e ajuste se procura num
 * lugar só.
 *
 * Nenhuma rota mudou: link salvo continua chegando, e a visibilidade segue
 * saindo de `ROUTE_PERMISSION`, item a item.
 */
export const NAV_GROUPS: { id: NavGroup; label: string }[] = [
  { id: "principal", label: "Menu principal" },
  { id: "configuracoes", label: "Configurações" },
];

/** Rotulo da barra do topo. Mesma normalizacao do guard de rota. */
export const pageTitleFor = (pathname: string): string => {
  const normalized = pathname.toLowerCase().replace(/\/+$/, "") || "/";
  return NAV_ITEMS.find((item) => item.url === normalized)?.title ?? "Faceimob";
};
