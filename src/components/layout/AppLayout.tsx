import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { Outlet, useLocation } from "react-router-dom";
import { useState, useEffect } from "react";
import { MotivationalPopup } from "@/components/MotivationalPopup";
import { RoleSwitcher } from "@/components/RoleSwitcher";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Trophy } from "lucide-react";
import { useGameRanking } from "@/hooks/useGameRanking";

const pageTitles: Record<string, string> = {
  "/dashboard": "Pipeline de Vendas",
  "/pipeline": "Pipeline",
  "/cca": "Pipeline CCA",
  "/leads": "Leads",
  "/resultados": "Resultados",
  "/marketing": "Marketing",
  "/equipes": "Equipes",
  "/links": "Links",
  "/data": "Dados",
  "/settings": "Configurações",
  "/admin/permissions": "Permissões",
  "/admin/developers": "Construtoras & CCA",
};

export default function AppLayout() {
  const [showMotivation, setShowMotivation] = useState(false);
  const [me, setMe] = useState<{ name: string; avatar_url: string | null } | null>(null);
  const location = useLocation();
  const pageTitle = pageTitles[location.pathname] || "Faceimob";
  const { user } = useAuth();
  const { scoped, myBroker, allScores } = useGameRanking();

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
    const justLogged = sessionStorage.getItem("faceimob-just-logged");
    if (justLogged === "true") {
      setShowMotivation(true);
      sessionStorage.removeItem("faceimob-just-logged");
    }
  }, []);

  // Header ranking: mirrors the Pipeline top ranking, scoped by role.
  // Broker sees only their own card entry; others see top 3 in scope.
  const headerScores = myBroker && scoped.length === 1
    ? [{ ...scoped[0], rank: allScores.findIndex(s => s.broker.id === myBroker.id) + 1 }]
    : scoped.slice(0, 3).map((s, i) => ({ ...s, rank: i + 1 }));

  return (
    <SidebarProvider style={{ "--sidebar-width": "13rem", "--sidebar-width-icon": "3.25rem" } as React.CSSProperties}>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center border-b border-border/30 glass px-4 sticky top-0 z-30">
            <SidebarTrigger className="mr-2 md:hidden" />
            <h1 className="text-sm font-semibold text-foreground mr-4">{pageTitle}</h1>
            
            <div className="hidden md:flex items-center gap-3 mx-auto overflow-hidden">
              {headerScores.map((s) => (
                <div key={s.broker.id} className="flex items-center gap-2 px-3 py-1 rounded-full border border-primary/20 bg-primary/5 transition-all duration-200 hover:scale-105 hover:border-primary/40 hover:bg-primary/10">
                  <span className="text-xs font-bold text-primary">{s.rank}º</span>
                  <Trophy className={s.rank === 1 ? "h-3 w-3 text-amber-500" : s.rank === 2 ? "h-3 w-3 text-gray-400" : "h-3 w-3 text-orange-600"} />
                  <span className="text-xs font-medium truncate max-w-[120px]">{s.broker.name}</span>
                  <span className="text-[10px] text-muted-foreground font-mono">{s.points} pts</span>
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
