import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shield, Lock, Eye, Pencil, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AppRole } from "@/contexts/AuthContext";

const roles: { value: AppRole; label: string; color: string }[] = [
  { value: 'admin', label: 'Administrador', color: 'text-red-400' },
  { value: 'partner', label: 'Sócio', color: 'text-purple-400' },
  { value: 'director', label: 'Diretor', color: 'text-blue-400' },
  { value: 'manager', label: 'Gerente', color: 'text-cyan-400' },
  { value: 'broker', label: 'Corretor', color: 'text-emerald-400' },
  { value: 'cca', label: 'CCA', color: 'text-amber-400' },
];

const permissionKeys = [
  { key: 'view_deals', label: 'Visualizar negócios', icon: Eye },
  { key: 'edit_deals', label: 'Editar negócios', icon: Pencil },
  { key: 'move_deals', label: 'Mover negócios entre etapas', icon: ArrowRight },
  { key: 'see_financial', label: 'Ver valores financeiros', icon: Lock },
  { key: 'see_conversion', label: 'Ver métricas de conversão', icon: Lock },
  { key: 'access_dashboard', label: 'Acessar dashboard', icon: Eye },
];

const stages = [
  { value: 'lead', label: 'Lead' },
  { value: 'proposal', label: 'Proposta' },
  { value: 'visit_scheduled', label: 'Visita Agendada' },
  { value: 'under_analysis', label: 'Em Análise' },
  { value: 'approved', label: 'Aprovado' },
  { value: 'contract', label: 'Contrato' },
  { value: 'closed', label: 'Fechado' },
];

type PermMap = Record<string, Record<string, boolean>>;

const initPerms = (): PermMap => {
  const m: PermMap = {};
  roles.forEach(r => {
    m[r.value] = {};
    permissionKeys.forEach(p => {
      m[r.value][p.key] = ['admin', 'partner', 'director'].includes(r.value);
    });
    if (r.value === 'manager') { m[r.value].view_deals = true; m[r.value].edit_deals = true; m[r.value].move_deals = true; m[r.value].see_conversion = true; m[r.value].access_dashboard = true; }
    if (r.value === 'broker') { m[r.value].view_deals = true; m[r.value].access_dashboard = true; }
    if (r.value === 'cca') { m[r.value].view_deals = true; }
  });
  return m;
};

type StagePermMap = Record<string, Record<string, { view: boolean; edit: boolean; move: boolean }>>;
const initStagePerms = (): StagePermMap => {
  const m: StagePermMap = {};
  roles.forEach(r => {
    m[r.value] = {};
    stages.forEach(s => {
      const isAdmin = ['admin', 'partner', 'director'].includes(r.value);
      m[r.value][s.value] = {
        view: r.value !== 'cca' || ['under_analysis', 'approved'].includes(s.value),
        edit: isAdmin || (r.value === 'manager' && !['closed'].includes(s.value)),
        move: isAdmin || (r.value === 'manager' && !['contract', 'closed'].includes(s.value)),
      };
    });
  });
  return m;
};

export default function AdminPermissions() {
  const [perms, setPerms] = useState<PermMap>(initPerms);
  const [stagePerms, setStagePerms] = useState<StagePermMap>(initStagePerms);
  const [selectedRole, setSelectedRole] = useState<AppRole>('broker');

  const togglePerm = (role: string, key: string) => {
    setPerms(prev => ({ ...prev, [role]: { ...prev[role], [key]: !prev[role][key] } }));
  };

  const toggleStagePerm = (role: string, stage: string, field: 'view' | 'edit' | 'move') => {
    setStagePerms(prev => ({
      ...prev,
      [role]: { ...prev[role], [stage]: { ...prev[role][stage], [field]: !prev[role][stage][field] } },
    }));
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2"><Shield className="h-5 w-5 text-primary" /> Permissões</h1>
        <p className="text-xs text-muted-foreground">Configure permissões por perfil de acesso</p>
      </div>

      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general" className="text-xs">Permissões Gerais</TabsTrigger>
          <TabsTrigger value="stages" className="text-xs">Permissões por Etapa</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {roles.map(role => (
              <Card key={role.value} className="border-border/50">
                <CardHeader className="py-3 px-4">
                  <CardTitle className={cn("text-sm flex items-center gap-2", role.color)}>
                    <Shield className="h-4 w-4" /> {role.label}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-3">
                  {permissionKeys.map(p => (
                    <div key={p.key} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <p.icon className="h-3 w-3 text-muted-foreground" />
                        <span className="text-xs">{p.label}</span>
                      </div>
                      <Switch
                        checked={perms[role.value]?.[p.key] ?? false}
                        onCheckedChange={() => togglePerm(role.value, p.key)}
                        disabled={role.value === 'admin'}
                      />
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="stages" className="space-y-4 mt-4">
          <div className="flex gap-2 flex-wrap mb-4">
            {roles.map(r => (
              <Badge
                key={r.value}
                variant={selectedRole === r.value ? "default" : "outline"}
                className={cn("cursor-pointer text-xs", selectedRole === r.value && "bg-primary")}
                onClick={() => setSelectedRole(r.value)}
              >
                {r.label}
              </Badge>
            ))}
          </div>

          <Card className="border-border/50">
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/40">
                    <th className="p-3 text-left font-medium text-muted-foreground">Etapa</th>
                    <th className="p-3 text-center font-medium text-muted-foreground">Visualizar</th>
                    <th className="p-3 text-center font-medium text-muted-foreground">Editar</th>
                    <th className="p-3 text-center font-medium text-muted-foreground">Mover</th>
                  </tr>
                </thead>
                <tbody>
                  {stages.map(stage => (
                    <tr key={stage.value} className="border-b border-border/10 hover:bg-primary/5">
                      <td className="p-3 font-medium">{stage.label}</td>
                      <td className="p-3 text-center">
                        <Switch
                          checked={stagePerms[selectedRole]?.[stage.value]?.view ?? false}
                          onCheckedChange={() => toggleStagePerm(selectedRole, stage.value, 'view')}
                          disabled={selectedRole === 'admin'}
                        />
                      </td>
                      <td className="p-3 text-center">
                        <Switch
                          checked={stagePerms[selectedRole]?.[stage.value]?.edit ?? false}
                          onCheckedChange={() => toggleStagePerm(selectedRole, stage.value, 'edit')}
                          disabled={selectedRole === 'admin'}
                        />
                      </td>
                      <td className="p-3 text-center">
                        <Switch
                          checked={stagePerms[selectedRole]?.[stage.value]?.move ?? false}
                          onCheckedChange={() => toggleStagePerm(selectedRole, stage.value, 'move')}
                          disabled={selectedRole === 'admin'}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
