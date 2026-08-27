import { useAuth, type AppRole } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
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
  admin: 'text-destructive',
  partner: 'text-chart-5',
  director: 'text-info',
  manager: 'text-info',
  broker: 'text-success',
  cca: 'text-warning',
  sdr: 'text-success',
  marketing: 'text-chart-5',
};

const PREVIEW_OFF = '__me__';

/** Mesmo texto no gatilho e na lista — senão o rótulo do papel diverge do item marcado. */
const optionLabel = (r: AppRole, isMine: boolean) =>
  isMine ? `${roleLabels[r]} (você)` : `Ver como ${roleLabels[r]}`;

/**
 * Pré-visualização de papel — ferramenta de admin para conferir o que cada
 * perfil enxerga depois de mexer na matriz de permissões.
 *
 * Só afeta a interface: o RLS continua respondendo pelos papéis reais do
 * usuário, então uma tela pré-visualizada como "corretor" ainda traz os dados
 * do admin. Serve para validar menu e botões, não para auditar dados.
 *
 * `role` é sempre o papel REAL (o `previewRole` só troca `effectiveRoles` no
 * AuthContext), por isso o item "(você)" continua certo durante a prévia.
 */
export function RoleSwitcher() {
  const { role, roles, isAdmin, previewRole, setPreviewRole } = useAuth();

  // Quem não é admin não troca de papel: veria um menu que não corresponde ao
  // que pode fazer. A trava real está no AuthContext; isto é a UI.
  if (!roles.includes('admin')) {
    return (
      <div className="flex items-center gap-2">
        <Shield className={cn("h-3.5 w-3.5 shrink-0", roleColors[role])} />
        <span className="text-xs text-muted-foreground">{roleLabels[role]}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      {previewRole
        ? <Eye className="h-3.5 w-3.5 shrink-0 text-warning" />
        : <Shield className={cn("h-3.5 w-3.5 shrink-0", roleColors[role])} />}
      <Select
        value={previewRole ?? PREVIEW_OFF}
        onValueChange={(v) => setPreviewRole(v === PREVIEW_OFF ? null : (v as AppRole))}
      >
        {/* A 375 px o gatilho encolhe para ícone + seta (~52 px em vez de 150).
            O que sai é o RÓTULO DO PAPEL, que é o último da fila de importância
            no cabeçalho — atrás do sino e do avatar. O `aria-label` continua
            nomeando o controle, então o encolhimento é só visual. */}
        <SelectTrigger
          className="h-7 w-auto gap-1 border-border/50 bg-transparent px-2 text-xs sm:w-36 sm:px-3"
          aria-label="Pré-visualizar como papel"
        >
          <SelectValue>
            <span className={cn("hidden sm:inline", previewRole ? "text-warning" : roleColors[role])}>
              {previewRole ? optionLabel(previewRole, false) : optionLabel(role, true)}
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={PREVIEW_OFF} className="text-xs">
            <span className={roleColors[role]}>{optionLabel(role, true)}</span>
          </SelectItem>
          {(Object.keys(roleLabels) as AppRole[]).filter(r => r !== 'admin').map(r => (
            <SelectItem key={r} value={r} className="text-xs">
              <span className={roleColors[r]}>{optionLabel(r, false)}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {/* Este aviso NÃO some no estreito: saber que você está vendo a tela como
          outra pessoa importa mais no celular, não menos. Por isso ele é curto
          — cabe a 375 px sem empurrar o sino para fora. */}
      {isAdmin ? null : (
        <Badge variant="outline" size="sm" className="shrink-0 border-warning/60 text-warning">
          prévia
        </Badge>
      )}
    </div>
  );
}
