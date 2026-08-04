import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shield, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  EDITABLE_ROLES,
  listPermissionCatalog,
  listPipelineStages,
  listRolePermissions,
  listStagePermissions,
  setRolePermission,
  setStagePermission,
  type PermissionRecord,
  type PipelineStageRecord,
} from "@/integrations/supabase/permissions";
import type { NewAppRole } from "@/integrations/supabase/newSchema";

const key = (role: string, code: string) => `${role}::${code}`;

export default function AdminPermissions() {
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<PermissionRecord[]>([]);
  const [stages, setStages] = useState<PipelineStageRecord[]>([]);
  /** role::permission → allowed */
  const [grants, setGrants] = useState<Record<string, boolean>>({});
  /** role::stage_id → { enter, exit } */
  const [stageGrants, setStageGrants] = useState<Record<string, { enter: boolean; exit: boolean }>>({});
  const [selectedRole, setSelectedRole] = useState<NewAppRole>("broker");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cat, rolePerms, pipelineStages, stagePerms] = await Promise.all([
        listPermissionCatalog(),
        listRolePermissions(),
        listPipelineStages(),
        listStagePermissions(),
      ]);
      setCatalog(cat);
      setStages(pipelineStages);
      setGrants(Object.fromEntries(rolePerms.map((r) => [key(r.role, r.permission), r.allowed])));
      setStageGrants(
        Object.fromEntries(
          stagePerms.map((s) => [key(s.role, s.stage_id), { enter: s.can_enter, exit: s.can_exit }]),
        ),
      );
    } catch (e) {
      toast({
        title: "Falha ao carregar permissões",
        description: e instanceof Error ? e.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const menuPermissions = useMemo(() => catalog.filter((p) => p.category === "menu"), [catalog]);
  const featurePermissions = useMemo(() => {
    const byCategory = new Map<string, PermissionRecord[]>();
    for (const p of catalog) {
      if (p.category === "menu") continue;
      const list = byCategory.get(p.category) ?? [];
      list.push(p);
      byCategory.set(p.category, list);
    }
    return [...byCategory.entries()];
  }, [catalog]);

  const toggleGrant = async (role: NewAppRole, code: string) => {
    const k = key(role, code);
    const next = !(grants[k] ?? false);
    setSaving(k);
    setGrants((prev) => ({ ...prev, [k]: next })); // otimista
    try {
      await setRolePermission(role, code, next);
    } catch (e) {
      setGrants((prev) => ({ ...prev, [k]: !next })); // desfaz
      toast({
        title: "Não foi possível salvar",
        description: e instanceof Error ? e.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setSaving(null);
    }
  };

  const toggleStage = async (role: NewAppRole, stageId: string, field: "enter" | "exit") => {
    const k = key(role, stageId);
    const currentValue = stageGrants[k] ?? { enter: true, exit: true };
    const next = { ...currentValue, [field]: !currentValue[field] };
    setSaving(k + field);
    setStageGrants((prev) => ({ ...prev, [k]: next }));
    try {
      await setStagePermission(stageId, role, { can_enter: next.enter, can_exit: next.exit });
    } catch (e) {
      setStageGrants((prev) => ({ ...prev, [k]: currentValue }));
      toast({
        title: "Não foi possível salvar",
        description: e instanceof Error ? e.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="grid place-items-center py-24 text-muted-foreground text-sm gap-2">
        <Loader2 className="h-5 w-5 animate-spin" />
        Carregando matriz de permissões...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2"><Shield className="h-5 w-5 text-primary" /> Permissões</h1>
        <p className="text-xs text-muted-foreground">
          Cada mudança grava na hora em <code>role_permissions</code> / <code>stage_permissions</code>.
          Administrador tem acesso total por construção e não aparece na matriz.
        </p>
      </div>

      {!isAdmin && (
        <p className="text-xs text-amber-400">
          Você está vendo a matriz em modo leitura — só administradores gravam
          (o banco recusa a escrita pelo RLS, não só a tela).
        </p>
      )}

      <Tabs defaultValue="menu">
        <TabsList>
          <TabsTrigger value="menu" className="text-xs">Acesso ao Menu</TabsTrigger>
          <TabsTrigger value="general" className="text-xs">Funcionalidades</TabsTrigger>
          <TabsTrigger value="stages" className="text-xs">Etapas do Pipeline</TabsTrigger>
        </TabsList>

        <TabsContent value="menu" className="space-y-4 mt-4">
          <Card className="border-border/50">
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/40">
                    <th className="p-2 text-left font-medium text-muted-foreground">Item do menu</th>
                    {EDITABLE_ROLES.map((r) => (
                      <th key={r.value} className={cn("p-2 text-center font-medium", r.color)}>{r.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {menuPermissions.map((p) => (
                    <tr key={p.code} className="border-b border-border/10 hover:bg-primary/5">
                      <td className="p-2 font-medium">{p.label}</td>
                      {EDITABLE_ROLES.map((r) => (
                        <td key={r.value} className="p-2 text-center">
                          <Switch
                            aria-label={`${p.label} para ${r.label}`}
                            checked={grants[key(r.value, p.code)] ?? false}
                            onCheckedChange={() => toggleGrant(r.value, p.code)}
                            disabled={!isAdmin || saving === key(r.value, p.code)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="general" className="space-y-4 mt-4">
          {featurePermissions.map(([category, items]) => (
            <Card key={category} className="border-border/50">
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/40">
                      <th className="p-2 text-left font-medium text-muted-foreground capitalize">{category}</th>
                      {EDITABLE_ROLES.map((r) => (
                        <th key={r.value} className={cn("p-2 text-center font-medium", r.color)}>{r.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((p) => (
                      <tr key={p.code} className="border-b border-border/10 hover:bg-primary/5">
                        <td className="p-2">
                          <span className="font-medium">{p.label}</span>
                          {p.description && <span className="block text-[10px] text-muted-foreground">{p.description}</span>}
                        </td>
                        {EDITABLE_ROLES.map((r) => (
                          <td key={r.value} className="p-2 text-center">
                            <Switch
                              aria-label={`${p.label} para ${r.label}`}
                              checked={grants[key(r.value, p.code)] ?? false}
                              onCheckedChange={() => toggleGrant(r.value, p.code)}
                              disabled={!isAdmin || saving === key(r.value, p.code)}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="stages" className="space-y-4 mt-4">
          <div className="flex gap-2 flex-wrap mb-4">
            {EDITABLE_ROLES.map((r) => (
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
                    <th className="p-3 text-center font-medium text-muted-foreground">Pode entrar</th>
                    <th className="p-3 text-center font-medium text-muted-foreground">Pode sair</th>
                  </tr>
                </thead>
                <tbody>
                  {stages.map((stage) => {
                    const g = stageGrants[key(selectedRole, stage.id)] ?? { enter: false, exit: false };
                    return (
                      <tr key={stage.id} className="border-b border-border/10 hover:bg-primary/5">
                        <td className="p-3 font-medium">{stage.label}</td>
                        <td className="p-3 text-center">
                          <Switch
                            aria-label={`Entrar em ${stage.label}`}
                            checked={g.enter}
                            onCheckedChange={() => toggleStage(selectedRole, stage.id, "enter")}
                            disabled={!isAdmin || saving === key(selectedRole, stage.id) + "enter"}
                          />
                        </td>
                        <td className="p-3 text-center">
                          <Switch
                            aria-label={`Sair de ${stage.label}`}
                            checked={g.exit}
                            onCheckedChange={() => toggleStage(selectedRole, stage.id, "exit")}
                            disabled={!isAdmin || saving === key(selectedRole, stage.id) + "exit"}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
          <p className="text-[10px] text-muted-foreground">
            "Pode entrar" é o que <code>can_enter_stage()</code> lê ao mover um negócio.
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
