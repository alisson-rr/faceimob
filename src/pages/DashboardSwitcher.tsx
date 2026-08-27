import { useAuth } from "@/contexts/AuthContext";
import Dashboard from "@/pages/Dashboard";
import DirectorDashboard from "@/pages/DirectorDashboard";

/**
 * Qual painel abrir depois do login.
 *
 * Papel e N:N (`user_roles`): um diretor tambem pode ser gerente e corretor, e
 * `role` guarda so o de maior precedencia. Perguntar `role === "director"`
 * fazia o diretor-corretor cair no painel errado — a pergunta certa e se
 * "director" esta ENTRE os papeis.
 *
 * `previewRole` vem na frente pelo mesmo motivo que vem em `can()`: quando o
 * admin usa o seletor de papel do header, a tela tem de acompanhar.
 */
export default function DashboardSwitcher() {
  const { roles, previewRole } = useAuth();
  const effectiveRoles = previewRole ? [previewRole] : roles;

  return effectiveRoles.includes("director") ? <DirectorDashboard /> : <Dashboard />;
}
