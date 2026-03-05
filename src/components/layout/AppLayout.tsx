import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { Outlet, useLocation } from "react-router-dom";
import { useState, useEffect } from "react";
import { MotivationalPopup } from "@/components/MotivationalPopup";
import dianhoAvatar from "@/assets/dianho.png";

const pageTitles: Record<string, string> = {
  "/dashboard": "Pipeline de Vendas",
  "/pipeline": "Pipeline",
  "/leads": "Leads",
  "/norteador": "Norteador",
  "/marketing": "Marketing",
  "/team": "Equipe",
  "/profile": "Pessoal",
  "/links": "Links",
  "/data": "Dados",
  "/settings": "Configurações",
};

export default function AppLayout() {
  const [showMotivation, setShowMotivation] = useState(false);
  const location = useLocation();
  const pageTitle = pageTitles[location.pathname] || "Faceimob";

  useEffect(() => {
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
            <h1 className="text-sm font-semibold text-foreground">{pageTitle}</h1>
            <div className="flex items-center gap-3 ml-auto">
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
