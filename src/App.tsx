import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { permissionForPath } from "@/lib/routePermissions";
import { UpdateNotifier } from "@/components/UpdateNotifier";
import AppLayout from "@/components/layout/AppLayout";
import Login from "@/pages/Login";
const DashboardSwitcher = lazy(() => import("@/pages/DashboardSwitcher"));
const Pipeline = lazy(() => import("@/pages/Pipeline"));
const Leads = lazy(() => import("@/pages/Leads"));

const Equipes = lazy(() => import("@/pages/Equipes"));
const Marketing = lazy(() => import("@/pages/Marketing"));
const DataManagement = lazy(() => import("@/pages/DataManagement"));
const SettingsPage = lazy(() => import("@/pages/Settings"));
const Resultados = lazy(() => import("@/pages/Resultados"));
const Links = lazy(() => import("@/pages/Links"));
const CcaPipeline = lazy(() => import("@/pages/CcaPipeline"));
const AdminPermissions = lazy(() => import("@/pages/AdminPermissions"));
const AdminIntegrations = lazy(() => import("@/pages/AdminIntegrations"));
const AdminDevelopers = lazy(() => import("@/pages/AdminDevelopers"));
const Gamification = lazy(() => import("@/pages/Gamification"));
const DailyReport = lazy(() => import("@/pages/DailyReport"));
const Checkpoint = lazy(() => import("@/pages/Checkpoint"));
const AdminDailyTeams = lazy(() => import("@/pages/AdminDailyTeams"));
const Checkin = lazy(() => import("@/pages/Checkin"));
const AdminAllowedIps = lazy(() => import("@/pages/AdminAllowedIps"));
const MetaAdsSetup = lazy(() => import("@/pages/MetaAdsSetup"));
const AdminLeadAutomation = lazy(() => import("@/pages/AdminLeadAutomation"));
const PublicDirectorCheckpoint = lazy(() => import("@/pages/PublicDirectorCheckpoint"));
const SdrModule = lazy(() => import("@/pages/SdrModule"));
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();
const bypassAuth = import.meta.env.VITE_BYPASS_AUTH === "true";

function RequireAuth() {
  const { session, loading } = useAuth();

  if (bypassAuth) {
    return <AppLayout />;
  }

  if (loading) {
    return <div className="min-h-screen grid place-items-center bg-background text-sm text-muted-foreground">Carregando...</div>;
  }

  return session ? <AppLayout /> : <Navigate to="/login" replace />;
}

/**
 * Barra a rota por permissão. Esconder o item no menu não protege a URL — sem
 * isto, quem soubesse o caminho abria a tela. Quem barra de verdade é o RLS,
 * mas uma tela vazia sem explicação parece defeito; esta é a mensagem honesta.
 */
function RequirePermission() {
  const { can, loading } = useAuth();
  const location = useLocation();

  if (bypassAuth) return <Outlet />;
  if (loading) return null;

  const code = permissionForPath(location.pathname);
  if (code && !can(code)) {
    return (
      <div className="grid place-items-center py-24 text-center">
        <div className="space-y-2 max-w-sm">
          <p className="text-sm font-semibold text-foreground">Acesso não liberado</p>
          <p className="text-xs text-muted-foreground">
            Seu perfil não tem permissão para esta tela. Fale com um administrador
            se precisar dela.
          </p>
        </div>
      </div>
    );
  }
  return <Outlet />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <UpdateNotifier />
        <BrowserRouter>
          {/* Uma rota por chunk: o bundle único de 2 MB obrigava a baixar todas
              as telas para abrir o login. O fallback é curto de propósito —
              chunk de rota carrega em milissegundos na rede da loja. */}
          <Suspense fallback={<div className="min-h-screen grid place-items-center bg-background text-sm text-muted-foreground">Carregando...</div>}>
          <Routes>
            <Route path="/login" element={<Login />} />
            {/* /reset-password saiu com a senha: o acesso é só por código (OTP). */}
            <Route path="/reset-password" element={<Navigate to="/login" replace />} />
            <Route path="/daily/:teamId/:slug" element={<DailyReport />} />
            <Route path="/daily/:slug" element={<DailyReport />} />
            <Route path="/diretor/:slug" element={<PublicDirectorCheckpoint />} />
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route element={<RequireAuth />}>
              <Route element={<RequirePermission />}>
              <Route path="/dashboard" element={<DashboardSwitcher />} />
              <Route path="/pipeline" element={<Pipeline />} />
              <Route path="/cca" element={<CcaPipeline />} />
              <Route path="/leads" element={<Leads />} />
              <Route path="/resultados" element={<Resultados />} />
              <Route path="/marketing" element={<Marketing />} />
              <Route path="/equipes" element={<Equipes />} />
              <Route path="/team" element={<Navigate to="/equipes" replace />} />
              <Route path="/profile" element={<Navigate to="/equipes" replace />} />
              <Route path="/links" element={<Links />} />
              <Route path="/data" element={<DataManagement />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/admin/permissions" element={<AdminPermissions />} />
              <Route path="/admin/integrations" element={<AdminIntegrations />} />
              <Route path="/admin/teams" element={<Navigate to="/equipes" replace />} />
              <Route path="/admin/developers" element={<AdminDevelopers />} />
              <Route path="/admin/daily-teams" element={<AdminDailyTeams />} />
              <Route path="/checkpoint" element={<Checkpoint />} />
              <Route path="/checkin" element={<Checkin />} />
              <Route path="/admin/allowed-ips" element={<AdminAllowedIps />} />
              <Route path="/admin/meta-ads" element={<MetaAdsSetup />} />
              <Route path="/admin/lead-automation" element={<AdminLeadAutomation />} />
              <Route path="/admin/daily-bi" element={<Navigate to="/checkpoint" replace />} />
              <Route path="/gamification" element={<Gamification />} />
              <Route path="/sdr" element={<SdrModule />} />
              </Route>
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
