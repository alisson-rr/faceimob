import { useAuth, type AppRole } from "@/contexts/AuthContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield } from "lucide-react";

const roleLabels: Record<AppRole, string> = {
  admin: 'Administrador',
  partner: 'Sócio',
  director: 'Diretor',
  manager: 'Gerente',
  broker: 'Corretor',
  cca: 'CCA',
};

const roleColors: Record<AppRole, string> = {
  admin: 'text-red-400',
  partner: 'text-purple-400',
  director: 'text-blue-400',
  manager: 'text-cyan-400',
  broker: 'text-emerald-400',
  cca: 'text-amber-400',
};

export function RoleSwitcher() {
  const { role, setDemoRole } = useAuth();

  return (
    <div className="flex items-center gap-2">
      <Shield className={`h-3.5 w-3.5 ${roleColors[role]}`} />
      <Select value={role} onValueChange={(v) => setDemoRole(v as AppRole)}>
        <SelectTrigger className="h-7 text-[10px] w-[120px] border-border/50 bg-transparent">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(roleLabels) as AppRole[]).map(r => (
            <SelectItem key={r} value={r} className="text-xs">
              <span className={roleColors[r]}>{roleLabels[r]}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
