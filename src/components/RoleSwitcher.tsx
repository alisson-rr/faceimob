import { useAuth, type AppRole } from "@/contexts/AuthContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield, Eye } from "lucide-react";

const roleLabels: Record<AppRole, string> = {
  admin: 'Administrador',
  partner: 'Sócio',
  director: 'Diretor',
  manager: 'Gerente',
  broker: 'Corretor',
  cca: 'CCA',
  sdr: 'SDR',
  marketing: 'Marketing',
};

const roleColors: Record<AppRole, string> = {
  admin: 'text-red-400',
  partner: 'text-purple-400',
  director: 'text-blue-400',
  manager: 'text-cyan-400',
  broker: 'text-emerald-400',
  cca: 'text-amber-400',
  sdr: 'text-teal-400',
  marketing: 'text-fuchsia-400',
};

const PREVIEW_OFF = '__me__';

/**
 * Pré-visualização de papel — ferramenta de admin para conferir o que cada
 * perfil enxerga depois de mexer na matriz de permissões.
 *
 * Só afeta a interface: o RLS continua respondendo pelos papéis reais do
 * usuário, então uma tela pré-visualizada como "corretor" ainda traz os dados
 * do admin. Serve para validar menu e botões, não para auditar dados.
 */
export function RoleSwitcher() {
  const { role, roles, isAdmin, previewRole, setPreviewRole } = useAuth();

  // Quem não é admin não troca de papel: veria um menu que não corresponde ao
  // que pode fazer. A trava real está no AuthContext; isto é a UI.
  if (!roles.includes('admin')) {
    return (
      <div className="flex items-center gap-2">
        <Shield className={`h-3.5 w-3.5 ${roleColors[role]}`} />
        <span className="text-[10px] text-muted-foreground">{roleLabels[role]}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {previewRole ? <Eye className="h-3.5 w-3.5 text-amber-400" /> : <Shield className={`h-3.5 w-3.5 ${roleColors[role]}`} />}
      <Select
        value={previewRole ?? PREVIEW_OFF}
        onValueChange={(v) => setPreviewRole(v === PREVIEW_OFF ? null : (v as AppRole))}
      >
        <SelectTrigger
          className="h-7 text-[10px] w-[150px] border-border/50 bg-transparent"
          aria-label="Pré-visualizar como papel"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={PREVIEW_OFF} className="text-xs">
            <span className={roleColors[role]}>{roleLabels[role]} (você)</span>
          </SelectItem>
          {(Object.keys(roleLabels) as AppRole[]).filter(r => r !== 'admin').map(r => (
            <SelectItem key={r} value={r} className="text-xs">
              <span className={roleColors[r]}>Ver como {roleLabels[r]}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isAdmin ? null : (
        <span className="text-[10px] text-amber-400 hidden sm:inline">pré-visualizando</span>
      )}
    </div>
  );
}
