import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { firstAllowedRoute, permissionForPath, safeRedirect } from "@/lib/routePermissions";
import { UpdateNotifier } from "@/components/UpdateNotifier";
import ErrorBoundary from "@/components/ErrorBoundary";
import AppLayout from "@/components/layout/AppLayout";
import Login from "@/pages/Login";
const DashboardSwitcher = lazy(() => import("@/pages/DashboardSwitcher"));
const Pipeline = lazy(() => import("@/pages/Pipeline"));
const Leads = lazy(() => import("@/pages/Leads"));
const Activities = lazy(() => import("@/pages/Activities"));

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

// `staleTime` de um minuto: sem ele toda volta de aba refazia as consultas do
// painel inteiro. `retry: 1` porque erro de RLS ou de permissão não melhora na
// terceira tentativa — só atrasa a mensagem que a tela tem para dar (achado A03).
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
});
// Ferramenta de dev: variável VITE_ vai para o bundle de produção, então o
// bypass só vale em build de desenvolvimento — em produção é sempre falso.
const bypassAuth = import.meta.env.DEV && import.meta.env.VITE_BYPASS_AUTH === "true";

const telaDeCarregamento = (
  <div className="min-h-screen grid place-items-center bg-background text-sm text-muted-foreground">Carregando...</div>
);

function RequireAuth() {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (bypassAuth) {
    return <AppLayout />;
  }

  if (loading) {
    return telaDeCarregamento;
  }

  if (session) return <AppLayout />;

  // Guarda o destino no `state` (não na URL: caminho com id de lead ou de
  // negócio não precisa ficar no histórico do navegador nem em log de acesso).
  // Sem isto, abrir um link de /pipeline sem sessão levava ao login e depois
  // jogava na home do papel — o link que a pessoa recebeu se perdia.
  return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
}

/**
 * O /login não é para quem já entrou.
 *
 * A rota fica fora do `RequireAuth`, então a tela de login aparecia normalmente
 * para usuário logado — e pior: `detectSessionInUrl` é o padrão do cliente
 * (`client.ts`), então quem chega pelo link do e-mail ABRE sessão e continua
 * olhando o formulário, como se não tivesse funcionado.
 */
function LoginRoute() {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (bypassAuth) return <Login />;
  if (loading) return telaDeCarregamento;

  // `safeRedirect` e não "/": se a sessão chegou logo depois de o guard mandar
  // para cá, o destino que a pessoa pediu está no `state` e é para lá que ela
  // volta — senão o link recebido morre na home mesmo com login bem-sucedido.
  return session ? <Navigate to={safeRedirect(location.state)} replace /> : <Login />;
}

/**
 * `/reset-password` — onde o link de recuperação do Supabase aterrissa.
 *
 * Era um `<Navigate to="/login">` imediato, e isso tinha dois defeitos.
 *
 * O primeiro: `Navigate` troca a URL na hora, e o token do e-mail vem no HASH.
 * O `detectSessionInUrl` (padrão do cliente) lê esse hash de forma assíncrona;
 * apagá-lo antes disso joga fora a sessão que o link acabou de abrir e a
 * pessoa volta ao formulário como se o link não tivesse funcionado.
 *
 * O segundo: mesmo dando certo, /login não é o lugar de quem veio TROCAR A
 * SENHA. Com a sessão aberta pelo link, o destino é a própria conta, onde o
 * bloco "Senha de acesso" existe. Sem sessão (link vencido, ou alguém digitando
 * a URL), aí sim é o /login.
 *
 * Nada disso funciona enquanto o SMTP do projeto não estiver configurado — o
 * e-mail de recuperação não sai. O caminho existir e estar certo é o que
 * permite que ligar o SMTP seja um passo só.
 */
function ResetPasswordRoute() {
  const { session, loading } = useAuth();

  if (bypassAuth) return <Navigate to="/settings" replace />;
  if (loading) return telaDeCarregamento;
  return <Navigate to={session ? "/settings" : "/login"} replace />;
}

/**
 * "/" não tem tela: manda para a primeira do menu que o papel abre. Mandava
 * para `/dashboard` fixo, e quem é só cca, sdr ou marketing não tem
 * `menu.dashboard` — entrava e a primeira tela do sistema era "Acesso não
 * liberado".
 *
 * É também o destino do pós-login, e tem de ser aqui: no submit do `Login` a
 * matriz de permissões ainda não carregou, o `can` daquele render é o de antes
 * da sessão e responderia "não" para tudo. Aqui `loading` garante a resposta
 * certa.
 */
function HomeRedirect() {
  const { can, loading } = useAuth();

  if (bypassAuth) return <Navigate to="/dashboard" replace />;
  if (loading) return telaDeCarregamento;

  return <Navigate to={firstAllowedRoute(can)} replace />;
}

/**
 * Barra a rota por permissão. Esconder o item no menu não protege a URL — sem
 * isto, quem soubesse o caminho abria a tela. Quem barra de verdade é o RLS,
 * mas uma tela vazia sem explicação parece defeito; esta é a mensagem honesta.
 */
function RequirePermission() {
  const { can, loading, previewRole } = useAuth();
  const location = useLocation();

  if (bypassAuth) return <Outlet />;
  if (loading) return null;

  const code = permissionForPath(location.pathname);
  if (code && !can(code)) {
    return (
      <div className="grid place-items-center py-24 text-center">
        <div className="space-y-2 max-w-sm">
          <p className="text-sm font-semibold text-foreground">Acesso não liberado</p>
          {/* Admin em pré-visualização batia aqui e achava que tinha perdido a
              própria permissão. O bloqueio é do papel que ele escolheu ver. */}
          <p className="text-xs text-muted-foreground">
            {previewRole
              ? "Você está pré-visualizando outro papel: é ele que não tem permissão para esta tela. Saia da prévia no cabeçalho para voltar ao seu acesso."
              : "Seu perfil não tem permissão para esta tela. Fale com um administrador se precisar dela."}
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
          <ErrorBoundary>
          <Suspense fallback={telaDeCarregamento}>
          <Routes>
            <Route path="/login" element={<LoginRoute />} />
            <Route path="/reset-password" element={<ResetPasswordRoute />} />
            <Route path="/daily/:teamId/:slug" element={<DailyReport />} />
            <Route path="/daily/:slug" element={<DailyReport />} />
            <Route path="/diretor/:slug" element={<PublicDirectorCheckpoint />} />
            <Route element={<RequireAuth />}>
              {/* Dentro do guard de sessão: sem sessão, "/" cai no login como
                  qualquer outra rota, em vez de saltar por /dashboard. */}
              <Route path="/" element={<HomeRedirect />} />
              <Route element={<RequirePermission />}>
              <Route path="/dashboard" element={<DashboardSwitcher />} />
              <Route path="/pipeline" element={<Pipeline />} />
              <Route path="/cca" element={<CcaPipeline />} />
              <Route path="/leads" element={<Leads />} />
              <Route path="/atividades" element={<Activities />} />
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
          </ErrorBoundary>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
