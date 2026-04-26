import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { Outlet, useLocation } from "react-router-dom";
import { useState, useEffect } from "react";
import { MotivationalPopup } from "@/components/MotivationalPopup";
import { RoleSwitcher } from "@/components/RoleSwitcher";
import dianhoAvatar from "@/assets/dianho.png";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Trophy } from "lucide-react";

interface TopBroker {
  id: string;
  name: string;
  points: number;
}

const pageTitles: Record<string, string> = {
  "/dashboard": "Pipeline de Vendas",
  "/pipeline": "Pipeline",
  "/cca": "Pipeline CCA",
  "/leads": "Leads",
  "/norteador": "Norteador",
  "/marketing": "Marketing",
  "/team": "Equipe",
  "/profile": "Pessoal",
  "/links": "Links",
  "/data": "Dados",
  "/settings": "Configurações",
  "/admin/permissions": "Permissões",
  "/admin/teams": "Gestão de Equipes",
  "/admin/developers": "Construtoras & CCA",
};

const roleLabels: Record<string, string> = {
  admin: 'Administrador',
  partner: 'Sócio',
  director: 'Diretor',
  manager: 'Gerente',
  broker: 'Corretor',
  cca: 'CCA',
};

export default function AppLayout() {
  const [showMotivation, setShowMotivation] = useState(false);
  const [topBrokers, setTopBrokers] = useState<TopBroker[]>([]);
  const location = useLocation();
  const pageTitle = pageTitles[location.pathname] || "Faceimob";
  const { role } = useAuth();

  useEffect(() => {
    const fetchTopBrokers = async () => {
      const { data } = await supabase.from('brokers').select('id, name').limit(3);
      if (data) {
        setTopBrokers(data.map((b, i) => ({
          id: b.id,
          name: b.name,
          points: 1000 - (i * 100)
        })));
      }
    };
    fetchTopBrokers();

    const justLogged = sessionStorage.getItem("faceimob-just-logged");
    if (justLogged === "true") {
      setShowMotivation(true);
      sessionStorage.removeItem("faceimob-just-logged");
    }
  }, []);

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center border-b border-border/30 glass px-4 sticky top-0 z-30">
            <SidebarTrigger className="mr-2 md:hidden" />
            <h1 className="text-sm font-semibold text-foreground mr-4">{pageTitle}</h1>
            
            {/* Ranking dos 3 primeiros */}
            <div className="hidden md:flex items-center gap-4 mx-auto overflow-hidden">
              {topBrokers.map((broker, i) => (
                <div key={broker.id} className="flex items-center gap-2 px-3 py-1 rounded-full border border-primary/20 bg-primary/5">
                  <span className="text-xs font-bold text-primary">{i + 1}º</span>
                  <Trophy className={i === 0 ? "h-3 w-3 text-amber-500" : i === 1 ? "h-3 w-3 text-gray-400" : "h-3 w-3 text-orange-600"} />
                  <span className="text-xs font-medium truncate max-w-[100px]">{broker.name}</span>
                  <span className="text-[10px] text-muted-foreground font-mono">{broker.points} pts</span>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-3 ml-auto">
              <RoleSwitcher />
              <span className="text-xs text-muted-foreground hidden sm:block">Dianho Silva</span>
              <img src={dianhoAvatar} alt="User" className="w-8 h-8 rounded-full object-cover border-2 border-primary/30" />
            </div>
          </header>
          <main className="flex-1 p-6 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
      {showMotivation && <MotivationalPopup />}
    </SidebarProvider>
  );
}
