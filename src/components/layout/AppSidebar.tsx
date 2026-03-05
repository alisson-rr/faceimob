import {
  LayoutDashboard, GitBranch, Users, UserPlus, Megaphone,
  UserCircle, Database, Settings, LogOut, Compass, Link2, Sun, Moon,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";
import logoFaceimob from "@/assets/logo-faceimob-white.png";
import logoFaceimobDark from "@/assets/logo-faceimob.png";
import logoSymbol from "@/assets/logo-faceimob-symbol-white.png";
import logoSymbolDark from "@/assets/logo-faceimob-symbol.png";
import { useTheme } from "@/hooks/useTheme";

const mainNav = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Pipeline", url: "/pipeline", icon: GitBranch },
  { title: "Leads", url: "/leads", icon: UserPlus },
  { title: "Norteador", url: "/norteador", icon: Compass },
  { title: "Marketing", url: "/marketing", icon: Megaphone },
  { title: "Equipe", url: "/team", icon: Users },
  { title: "Pessoal", url: "/profile", icon: UserCircle },
  { title: "Links", url: "/links", icon: Link2 },
];

const systemNav = [
  { title: "Dados", url: "/data", icon: Database },
  { title: "Configurações", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const isActive = (path: string) => location.pathname === path;
  const isLight = theme === "light";

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <div className="p-4 flex items-center justify-center">
          {!collapsed ? (
            <img src={isLight ? logoFaceimobDark : logoFaceimob} alt="Faceimob" className="h-10 object-contain transition-all duration-300" />
          ) : (
            <img src={isLight ? logoSymbolDark : logoSymbol} alt="Faceimob" className="w-8 h-8 object-contain transition-all duration-300" />
          )}
        </div>

        <SidebarGroup>
          <SidebarGroupLabel>Menu Principal</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNav.map((item, i) => (
                <SidebarMenuItem key={item.title} style={{ animationDelay: `${i * 50}ms` }} className="animate-fade-in">
                  <SidebarMenuButton asChild isActive={isActive(item.url)}>
                    <NavLink to={item.url} end activeClassName="bg-primary/15 text-primary glow-primary">
                      <item.icon className="h-4 w-4 transition-transform duration-200 group-hover:scale-110" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Sistema</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {systemNav.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)}>
                    <NavLink to={item.url} end activeClassName="bg-primary/15 text-primary glow-primary">
                      <item.icon className="h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={toggleTheme} className="transition-all duration-200 hover:bg-primary/10">
              {isLight ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              {!collapsed && <span>{isLight ? "Modo Escuro" : "Versão White"}</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton className="text-destructive hover:text-destructive" onClick={() => navigate('/login')}>
              <LogOut className="h-4 w-4" />
              {!collapsed && <span>Sair</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
