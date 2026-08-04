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
  "/settings": "menu.settings",
  "/admin/permissions": "menu.admin_permissions",
  "/admin/integrations": "menu.admin_integrations",
  "/admin/developers": "menu.admin_developers",
  "/admin/daily-teams": "menu.admin_daily_teams",
  "/admin/allowed-ips": "menu.admin_allowed_ips",
  "/admin/lead-automation": "menu.admin_lead_automation",
  "/admin/meta-ads": "menu.admin_lead_automation",
};

export const permissionForPath = (pathname: string): string | undefined =>
  ROUTE_PERMISSION[pathname];
