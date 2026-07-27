import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { UpdateNotifier } from "@/components/UpdateNotifier";
import AppLayout from "@/components/layout/AppLayout";
import Login from "@/pages/Login";
import ResetPassword from "@/pages/ResetPassword";
import DashboardSwitcher from "@/pages/DashboardSwitcher";
import Pipeline from "@/pages/Pipeline";

import Equipes from "@/pages/Equipes";
import Marketing from "@/pages/Marketing";
import DataManagement from "@/pages/DataManagement";
import SettingsPage from "@/pages/Settings";
import Resultados from "@/pages/Resultados";
import Links from "@/pages/Links";
import CcaPipeline from "@/pages/CcaPipeline";
import AdminPermissions from "@/pages/AdminPermissions";
import AdminDevelopers from "@/pages/AdminDevelopers";
import Gamification from "@/pages/Gamification";
import DailyReport from "@/pages/DailyReport";
import Checkpoint from "@/pages/Checkpoint";
import AdminDailyTeams from "@/pages/AdminDailyTeams";
import Checkin from "@/pages/Checkin";
import AdminAllowedIps from "@/pages/AdminAllowedIps";
import MetaAdsSetup from "@/pages/MetaAdsSetup";
import AdminLeadAutomation from "@/pages/AdminLeadAutomation";
import PublicDirectorCheckpoint from "@/pages/PublicDirectorCheckpoint";
import SdrModule from "@/pages/SdrModule";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();
const bypassAuth = import.meta.env.DEV;

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

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <UpdateNotifier />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/daily/:teamId/:slug" element={<DailyReport />} />
            <Route path="/daily/:slug" element={<DailyReport />} />
            <Route path="/diretor/:slug" element={<PublicDirectorCheckpoint />} />
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route element={<RequireAuth />}>
              <Route path="/dashboard" element={<DashboardSwitcher />} />
              <Route path="/pipeline" element={<Pipeline />} />
              <Route path="/cca" element={<CcaPipeline />} />
              <Route path="/leads" element={<Navigate to="/pipeline" replace />} />
              <Route path="/resultados" element={<Resultados />} />
              <Route path="/marketing" element={<Marketing />} />
              <Route path="/equipes" element={<Equipes />} />
              <Route path="/team" element={<Navigate to="/equipes" replace />} />
              <Route path="/profile" element={<Navigate to="/equipes" replace />} />
              <Route path="/links" element={<Links />} />
              <Route path="/data" element={<DataManagement />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/admin/permissions" element={<AdminPermissions />} />
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
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
