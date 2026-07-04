import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { Outlet, useLocation } from "react-router-dom";
import { useState, useEffect } from "react";
import { MotivationalPopup } from "@/components/MotivationalPopup";
import { RoleSwitcher } from "@/components/RoleSwitcher";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Trophy } from "lucide-react";

interface TopBroker {
  id: string;
  name: string;
  points: number;
}

interface DashboardDealSummary {
  id: string;
  status?: string | null;
  stage?: string | null;
  active?: boolean | null;
  broker1_id?: string | null;
  broker1_name?: string | null;
}

const pageTitles: Record<string, string> = {
  "/dashboard": "Pipeline de Vendas",
  "/pipeline": "Pipeline",
  "/cca": "Pipeline CCA",
  "/leads": "Leads",
  "/norteador": "Norteador",
  "/marketing": "Marketing",
  "/equipes": "Equipes",
  
  "/links": "Links",
  "/data": "Dados",
  "/settings": "Configurações",
  "/admin/permissions": "Permissões",
  
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
  const [me, setMe] = useState<{ name: string; avatar_url: string | null } | null>(null);
  const location = useLocation();
  const pageTitle = pageTitles[location.pathname] || "Faceimob";
  const { role, user } = useAuth();

  useEffect(() => {
    if (!user?.id) { setMe(null); return; }
    (async () => {
      const { data: byId } = await supabase
        .from("brokers").select("name, avatar_url")
        .eq("user_id", user.id).maybeSingle();
      if (byId) { setMe(byId as any); return; }
      if (user.email) {
        const { data: byEmail } = await supabase
          .from("brokers").select("name, avatar_url")
          .or(`login_email.eq.${user.email},email.eq.${user.email}`)
          .maybeSingle();
        if (byEmail) { setMe(byEmail as any); return; }
      }
      const meta: any = user.user_metadata || {};
      setMe({ name: meta.name || meta.full_name || user.email || "Usuário", avatar_url: meta.avatar_url || null });
    })();
  }, [user?.id, user?.email]);

  useEffect(() => {
    const fetchTopBrokers = async () => {
      const { data, error } = await supabase
        .from("dashboard_bi_cache" as any)
        .select("payload")
        .eq("id", true)
        .maybeSingle();
      if (error) return;

      const deals = (((data as any)?.payload?.deals || []) as DashboardDealSummary[]);
      const scores = new Map<string, TopBroker>();

      deals.forEach((deal) => {
        if (!deal.broker1_id) return;
        const current = scores.get(deal.broker1_id) || {
          id: deal.broker1_id,
          name: deal.broker1_name || "Corretor",
          points: 0,
        };
        const status = (deal.status || "").toUpperCase();
        if (status === "VENDA" && deal.active !== false) current.points += 700;
        else if (deal.stage === "approved") current.points += 250;
        else current.points += 50;
        scores.set(deal.broker1_id, current);
      });

      setTopBrokers(Array.from(scores.values()).sort((a, b) => b.points - a.points).slice(0, 3));
    };
    fetchTopBrokers();

    const justLogged = sessionStorage.getItem("faceimob-just-logged");
    if (justLogged === "true") {
      setShowMotivation(true);
      sessionStorage.removeItem("faceimob-just-logged");
    }
  }, []);

  return (
    <SidebarProvider style={{ "--sidebar-width": "13rem", "--sidebar-width-icon": "3.25rem" } as React.CSSProperties}>
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
              <span className="text-xs text-muted-foreground hidden sm:block">{me?.name || user?.email || "Usuário"}</span>
              {me?.avatar_url ? (
                <img src={me.avatar_url} alt="User" className="w-8 h-8 rounded-full object-cover border-2 border-primary/30" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-primary/20 border-2 border-primary/30 flex items-center justify-center text-xs font-bold text-primary">
                  {(me?.name || user?.email || "U").charAt(0).toUpperCase()}
                </div>
              )}
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
