import { useAuth } from "@/contexts/AuthContext";
import Dashboard from "@/pages/Dashboard";
import DirectorDashboard from "@/pages/DirectorDashboard";

export default function DashboardSwitcher() {
  const { role } = useAuth();
  if (role === "director") return <DirectorDashboard />;
  return <Dashboard />;
}
