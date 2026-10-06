import { Globe, LogOut, Moon, Sun } from "lucide-react";
import { permissionForPath } from "@/lib/routePermissions";
import { NavLink } from "@/components/NavLink";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";
import { Logo } from "@/components/shared/Logo";
import { useTheme } from "@/hooks/useTheme";
import { memo, useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { SITE_PUBLICO } from "@/integrations/supabase/central";
import { NAV_GROUPS, NAV_ITEMS, type NavItem } from "@/components/layout/navigation";

/** Duração da animação do painel — `duration-500` em `@/components/ui/sidebar`. */
const ANIMACAO_DO_PAINEL_MS = 500;

/**
 * Item com `memo`: trocar de rota muda o `active` de dois itens, e sem isto os
 * 23 re-renderizavam com a árvore de Tooltip do Radix (76% do custo do layout
 * por navegação). Depende de `NAV_ITEMS` ser constante de módulo.
 */
const ItemDoMenu = memo(function ItemDoMenu({ item, active, collapsed, onEscolher }: {
  item: NavItem; active: boolean; collapsed: boolean; onEscolher: () => void;
}) {
  return (
    <SidebarMenuItem>
      {/* Item ativo (12/09/2026): pílula escura com borda fina e ícone
          em âmbar, sem brilho — era pílula azul cheia com halo azul.
          A borda é `inset` em `box-shadow` para não mexer 1 px no
          layout e somar com o anel de foco em vez de trocá-lo.
          `sidebar-highlight` e não `gold`: no claro a barra é azul e o
          `gold` de lá (feito para texto sobre branco) dava 1,4:1. */}
      <SidebarMenuButton
        asChild
        isActive={active}
        tooltip={item.title}
        className="data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[active=true]:shadow-[inset_0_0_0_1px_hsl(var(--sidebar-highlight))]"
      >
        <NavLink to={item.url} end onClick={onEscolher}>
          <item.icon className={cn("h-4 w-4", active && "text-sidebar-highlight")} />
          {/* Recolhida, a barra esconde o rotulo — mas ele nao pode sair do
              DOM: o icone nao carrega texto, entao sem o <span> TODO link do
              menu fica sem nome acessivel. E nao e estado raro: o
              `handleMouseLeave` do AppSidebar recolhe a barra sozinho 500 ms
              depois que o ponteiro sai dela. `sr-only` tira da vista sem tirar
              da arvore de acessibilidade — mesmo pixel, com nome. */}
          <span className={cn(collapsed && "sr-only")}>{item.title}</span>
        </NavLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
});

export function AppSidebar() {
  const { state, setOpen, isMobile, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { can, signOut, isAdmin } = useAuth();
  const isActive = (path: string) => location.pathname === path;
  const isLight = theme === "light";
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>();

  /**
   * Aberto pelo hover, o painel passa POR CIMA do conteúdo: o espaçador fica na
   * largura do ícone e a página não muda de largura. Antes ele empurrava o
   * conteúdo animando a largura por 500 ms, e o navegador refazia o layout e
   * repintava a tela inteira a cada quadro — travava no Pipeline e em Leads.
   * Fica `true` até o painel terminar de fechar, senão o cabeçalho cobre a
   * animação.
   */
  const [sobreposto, setSobreposto] = useState(false);
  // Lido por `fecharAoEscolher` sem entrar nas dependências dele: a função
  // chega aos 23 itens `memo`, e mudar a cada hover re-renderizava todos.
  const sobrepostoRef = useRef(sobreposto);
  sobrepostoRef.current = sobreposto;

  const handleMouseEnter = useCallback(() => {
    clearTimeout(hoverTimer.current);
    if (collapsed) {
      hoverTimer.current = setTimeout(() => {
        setSobreposto(true);
        setOpen(true);
      }, 350);
    }
  }, [collapsed, setOpen]);

  const handleMouseLeave = useCallback(() => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => {
      setSobreposto(true);
      setOpen(false);
      hoverTimer.current = setTimeout(() => setSobreposto(false), ANIMACAO_DO_PAINEL_MS);
    }, 500);
  }, [setOpen]);

  /**
   * Escolher uma opção fecha o menu (pedido de 28/09/2026). No celular a gaveta
   * ficava aberta por cima da tela nova até um toque fora; no computador, o
   * painel aberto pelo hover só fechava quando o ponteiro saía — e em tela de
   * toque o ponteiro nunca "sai". Fecha como o `handleMouseLeave`, sem a espera.
   */
  const fecharAoEscolher = useCallback(() => {
    clearTimeout(hoverTimer.current);
    if (isMobile) {
      setOpenMobile(false);
      return;
    }
    if (!sobrepostoRef.current) return;
    setOpen(false);
    hoverTimer.current = setTimeout(() => setSobreposto(false), ANIMACAO_DO_PAINEL_MS);
  }, [isMobile, setOpenMobile, setOpen]);

  // Sem codigo mapeado a rota e livre — so o que exige permissao esta no mapa.
  const visible = (item: NavItem) => {
    if (item.hidden) return false;
    const code = permissionForPath(item.url);
    return code ? can(code) : true;
  };

  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: NAV_ITEMS.filter((item) => item.group === group.id && visible(item)),
  })).filter((group) => group.items.length > 0);

  return (
    <Sidebar collapsible="icon" overlay={sobreposto} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      <SidebarContent className="gap-0">
        {/* Qual arquivo de logo vale em cada tema e decidido em
            `@/components/shared/Logo` — inclusive o asset que ainda falta. */}
        <div className="flex h-16 items-center justify-center px-4">
          {!collapsed ? <Logo className="h-9" /> : <Logo variant="symbol" className="h-8 w-8" />}
        </div>
        <div className="mx-3 h-px bg-sidebar-border" />

        {/* O rótulo do grupo era só pintura: `SidebarGroup` é uma `div` sem papel
            nem nome, então quem usa leitor de tela ouvia uma lista corrida de
            links, sem saber onde termina o menu de trabalho e começa o de
            configuração. `role="group"` + `aria-labelledby` amarram os dois —
            e é o que permite a um teste cobrar "o corretor vê o grupo
            Configurações com um item só". */}
        {groups.map((group) => (
          <SidebarGroup key={group.id} role="group" aria-labelledby={`nav-grupo-${group.id}`}>
            <SidebarGroupLabel id={`nav-grupo-${group.id}`}>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <ItemDoMenu
                    key={item.url} item={item} active={isActive(item.url)} collapsed={collapsed}
                    onEscolher={fecharAoEscolher}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          {/* Atalho para o painel do site (decisão de 05/10/2026): o site já usa
              o banco e os logins do CRM, então o painel dele continua lá, em vez
              de ser refeito tela a tela aqui. Só admin e sócio gravam por lá. */}
          {isAdmin && (
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="Admin do site">
                <a href={`${SITE_PUBLICO}/admin`} target="_blank" rel="noopener noreferrer" onClick={fecharAoEscolher}>
                  <Globe className="h-4 w-4" aria-hidden />
                  {!collapsed && <span>Admin do site</span>}
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={toggleTheme}
              aria-label={isLight ? "Mudar para o tema escuro" : "Mudar para o tema claro"}
              tooltip={isLight ? "Tema escuro" : "Tema claro"}
            >
              {isLight ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              {!collapsed && <span>{isLight ? "Tema escuro" : "Tema claro"}</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="text-sidebar-destructive hover:text-sidebar-destructive"
              onClick={async () => {
                await signOut();
                navigate("/login");
              }}
              aria-label="Sair da conta"
              tooltip="Sair"
            >
              <LogOut className="h-4 w-4" />
              {!collapsed && <span>Sair</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
