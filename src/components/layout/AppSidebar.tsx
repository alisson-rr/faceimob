import { LogOut, Moon, Sun } from "lucide-react";
import { permissionForPath } from "@/lib/routePermissions";
import { NavLink } from "@/components/NavLink";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";
import logoFaceimobWhite from "@/assets/logo-faceimob-white.png";
import logoFaceimobColor from "@/assets/logo-faceimob.png";
import logoSymbolWhite from "@/assets/logo-faceimob-symbol-white.png";
import logoSymbolColor from "@/assets/logo-faceimob-symbol.png";
import { useTheme } from "@/hooks/useTheme";
import { useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { NAV_GROUPS, NAV_ITEMS, type NavItem } from "@/components/layout/navigation";

export function AppSidebar() {
  const { state, setOpen } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { can, signOut } = useAuth();
  const isActive = (path: string) => location.pathname === path;
  const isLight = theme === "light";
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>();

  const handleMouseEnter = useCallback(() => {
    clearTimeout(hoverTimer.current);
    if (collapsed) {
      hoverTimer.current = setTimeout(() => setOpen(true), 350);
    }
  }, [collapsed, setOpen]);

  const handleMouseLeave = useCallback(() => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setOpen(false), 500);
  }, [setOpen]);

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
    <Sidebar collapsible="icon" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      <SidebarContent className="gap-0">
        {/* Nao existe asset de logo com letra escura: `logo-faceimob.png` e
            `logo-faceimob-white.png` sao o MESMO desenho de letra branca, que
            some no sidebar claro. Ate a marca entregar a versao escura, o tema
            claro usa a mesma arte sobre uma placa azul da marca — some com o
            problema de contraste sem inventar outra tipografia. */}
        <div className="flex h-16 items-center justify-center px-4">
          {!collapsed ? (
            <img
              src={isLight ? logoFaceimobColor : logoFaceimobWhite}
              alt="Faceimob"
              className={cn("h-9 object-contain", isLight && "rounded-xl bg-brand-blue px-3 py-1.5")}
            />
          ) : (
            <img
              src={isLight ? logoSymbolColor : logoSymbolWhite}
              alt="Faceimob"
              className="h-8 w-8 object-contain"
            />
          )}
        </div>
        <div className="mx-3 h-px bg-sidebar-border" />

        {groups.map((group) => (
          <SidebarGroup key={group.id}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                      <NavLink to={item.url} end activeClassName="glow-primary">
                        <item.icon className="h-4 w-4" />
                        {/* Recolhida, a barra esconde o rotulo — mas ele nao pode sair do
                            DOM: o icone nao carrega texto, entao sem o <span> TODO link do
                            menu fica sem nome acessivel. E nao e estado raro: o
                            `handleMouseLeave` acima recolhe a barra sozinho 500 ms depois
                            que o ponteiro sai dela. `sr-only` tira da vista sem tirar da
                            arvore de acessibilidade — mesmo pixel, com nome. */}
                        <span className={cn(collapsed && "sr-only")}>{item.title}</span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
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
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
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
