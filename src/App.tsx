import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/layout/AppLayout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Pipeline from "@/pages/Pipeline";

import Equipes from "@/pages/Equipes";
import Marketing from "@/pages/Marketing";
import DataManagement from "@/pages/DataManagement";
import SettingsPage from "@/pages/Settings";
import Norteador from "@/pages/Norteador";
import Links from "@/pages/Links";
import CcaPipeline from "@/pages/CcaPipeline";
import AdminPermissions from "@/pages/AdminPermissions";
import AdminDevelopers from "@/pages/AdminDevelopers";
import Gamification from "@/pages/Gamification";
import DailyReport from "@/pages/DailyReport";
import DailyBI from "@/pages/DailyBI";
import AdminDailyTeams from "@/pages/AdminDailyTeams";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function RequireAuth() {
  const { session, loading } = useAuth();

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
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/daily/:teamId" element={<DailyReport />} />
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route element={<RequireAuth />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/pipeline" element={<Pipeline />} />
              <Route path="/cca" element={<CcaPipeline />} />
              <Route path="/leads" element={<Navigate to="/pipeline" replace />} />
              <Route path="/norteador" element={<Norteador />} />
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
              <Route path="/admin/daily-bi" element={<DailyBI />} />
              <Route path="/gamification" element={<Gamification />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
