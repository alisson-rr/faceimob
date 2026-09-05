import {
  Bot, Building2, CalendarClock, CreditCard, Database, GitBranch, Globe, KeyRound, LayoutDashboard,
  Link2, LogIn, Megaphone, Settings, Shield, Target, TrendingUp, Trophy, UserSearch, Users, Zap,
  type LucideIcon,
} from "lucide-react";

export type NavGroup = "principal" | "admin" | "sistema";

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
  { title: "Links", url: "/links", icon: Link2, group: "principal" },
  { title: "Gamificação", url: "/gamification", icon: Trophy, group: "principal" },
  { title: "Resultados", url: "/resultados", icon: TrendingUp, group: "principal" },
  { title: "Checkpoint", url: "/checkpoint", icon: Target, group: "principal" },
  { title: "Check-in", url: "/checkin", icon: LogIn, group: "principal" },
  { title: "SDR IA", url: "/sdr", icon: Bot, group: "principal" },

  { title: "Permissões", url: "/admin/permissions", icon: Shield, group: "admin" },
  { title: "Integrações", url: "/admin/integrations", icon: KeyRound, group: "admin" },
  { title: "Construtoras", url: "/admin/developers", icon: Building2, group: "admin" },
  { title: "Diário — Links", url: "/admin/daily-teams", icon: KeyRound, group: "admin" },
  { title: "IPs autorizados", url: "/admin/allowed-ips", icon: Globe, group: "admin" },
  { title: "Automação Leads", url: "/admin/lead-automation", icon: Zap, group: "admin" },
  { title: "Meta Ads", url: "/admin/meta-ads", icon: Megaphone, group: "admin" },

  { title: "Dados", url: "/data", icon: Database, group: "sistema" },
  { title: "Configurações", url: "/settings", icon: Settings, group: "sistema" },
];

export const NAV_GROUPS: { id: NavGroup; label: string }[] = [
  { id: "principal", label: "Menu principal" },
  { id: "admin", label: "Administração" },
  { id: "sistema", label: "Sistema" },
];

/** Rotulo da barra do topo. Mesma normalizacao do guard de rota. */
export const pageTitleFor = (pathname: string): string => {
  const normalized = pathname.toLowerCase().replace(/\/+$/, "") || "/";
  return NAV_ITEMS.find((item) => item.url === normalized)?.title ?? "Faceimob";
};
