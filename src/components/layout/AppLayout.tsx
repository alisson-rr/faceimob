import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { Outlet, useLocation } from "react-router-dom";
import { useState, useEffect } from "react";
import { MotivationalPopup } from "@/components/MotivationalPopup";
import { RoleSwitcher } from "@/components/RoleSwitcher";
import NewLeadNotifier from "@/components/NewLeadNotifier";

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
          <header className="h-14 flex items-center border-b border-border/30 glass px-5 sticky top-0 z-30 relative">
            <SidebarTrigger className="mr-3 md:hidden" />
            <h1 className="text-[13px] font-semibold tracking-tight text-foreground mr-6">{pageTitle}</h1>

            <div className="hidden md:flex items-center gap-2 mx-auto overflow-hidden">
              {headerScores.map((s, i) => (
                <div
                  key={s.broker.id}
                  style={{ animationDelay: `${i * 80}ms` }}
                  className="animate-fade-in flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary/15 bg-primary/[0.04] backdrop-blur-md interactive ease-premium hover:border-primary/40 hover:bg-primary/10 hover:-translate-y-0.5"
                >
                  <span className="text-[11px] font-semibold text-primary tabular-nums">{s.rank}º</span>
                  <Trophy className={s.rank === 1 ? "h-3 w-3 text-amber-400" : s.rank === 2 ? "h-3 w-3 text-slate-300" : "h-3 w-3 text-orange-500"} />
                  <span className="text-xs font-medium truncate max-w-[120px]">{s.broker.name}</span>
                  <span className="text-[10px] text-muted-foreground font-mono tabular-nums">{s.points} pts</span>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-3 ml-auto">
              <RoleSwitcher />
              <span className="text-xs text-muted-foreground hidden sm:block tracking-tight">{me?.name || user?.email || "Usuário"}</span>
              {me?.avatar_url ? (
                <img src={me.avatar_url} alt="User" className="w-8 h-8 rounded-full object-cover border border-primary/30 ring-2 ring-background shadow-elevate interactive hover:scale-105" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 border border-primary/30 ring-2 ring-background flex items-center justify-center text-xs font-semibold text-primary shadow-elevate">
                  {(me?.name || user?.email || "U").charAt(0).toUpperCase()}
                </div>
              )}
            </div>

            {/* hairline accent */}
            <span aria-hidden className="pointer-events-none absolute inset-x-0 -bottom-px h-px gradient-hairline opacity-60" />
          </header>
          <main className="flex-1 p-6 overflow-auto gradient-premium">
            <div className="animate-fade-in">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
      {showMotivation && <MotivationalPopup />}
      <NewLeadNotifier />
    </SidebarProvider>
  );
}
