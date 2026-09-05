import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shield, AlertTriangle } from "lucide-react";
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
import { describeError } from "@/lib/supabaseError";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState, PageHeader, StatusBadge, type StatusTone } from "@/components/shared";
import { enforcementLabel, enforcementOf, type EnforcedBy } from "@/lib/featurePermissions";

const key = (role: string, code: string) => `${role}::${code}`;

const ENFORCEMENT_TONE: Record<NonNullable<EnforcedBy> | "none", StatusTone> = {
  banco: "success",
  tela: "info",
  none: "warning",
};

/** Selo + frase de "Onde vale". Vale nas duas abas: desde a 0044 há código de
 *  menu que também é predicado de RLS, então a aba Menu não pode omitir isso. */
function EnforcementCell({ code }: { code: string }) {
  const enforcement = enforcementOf(code);
  return (
    <td className="p-2 min-w-56 max-w-xs">
      <StatusBadge tone={ENFORCEMENT_TONE[enforcement.enforcedBy ?? "none"]}>
        {enforcementLabel(enforcement)}
      </StatusBadge>
      <span className="block text-xs text-muted-foreground mt-1">{enforcement.where}</span>
    </td>
  );
}

export default function AdminPermissions() {
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  /** Falha de carga renderizava tabela vazia só com cabeçalho — nem estado
   *  vazio, nem botão de tentar de novo; o único sinal era um toast que sumia. */
  const [loadError, setLoadError] = useState<string | null>(null);
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
    setLoadError(null);
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
      const motivo = describeError(e, "Não foi possível carregar a matriz de permissões.");
      setLoadError(motivo);
      toast({ title: "Falha ao carregar permissões", description: motivo, variant: "destructive" });
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
        description: describeError(e, "Não foi possível salvar a permissão."),
        variant: "destructive",
      });
    } finally {
      setSaving(null);
    }
  };

  /** Rótulos dos papéis que podem ENTRAR na etapa — a leitura que faltava. */
  const entramNaEtapa = (stageId: string) =>
    EDITABLE_ROLES
      .filter((r) => stageGrants[key(r.value, stageId)]?.enter)
      .map((r) => r.label)
      .join(", ");

  const toggleStage = async (role: NewAppRole, stageId: string, field: "enter" | "exit") => {
    const k = key(role, stageId);
    // Linha ausente no banco = negado (mesma base da exibição). Partir de
    // true aqui gravava concessão não intencional no primeiro clique.
    const currentValue = stageGrants[k] ?? { enter: false, exit: false };
    const next = { ...currentValue, [field]: !currentValue[field] };
    setSaving(k + field);
    setStageGrants((prev) => ({ ...prev, [k]: next }));
    try {
      await setStagePermission(stageId, role, { can_enter: next.enter, can_exit: next.exit });
    } catch (e) {
      setStageGrants((prev) => ({ ...prev, [k]: currentValue }));
      toast({
        title: "Não foi possível salvar",
        description: describeError(e, "Não foi possível salvar a permissão da etapa."),
        variant: "destructive",
      });
    } finally {
      setSaving(null);
    }
  };

  // O kit já traz `role="status"`, `aria-busy` e `aria-live`: o spinner solto
  // não avisava nada a quem não vê a animação.
  if (loading) return <LoadingState variant="table" rows={6} label="Carregando matriz de permissões…" />;

  if (loadError) {
    // Tabela vazia aqui não é "ninguém tem permissão": é "não sabemos quem
    // tem". Mostrar as três abas em branco convidaria o admin a reconfigurar
    // uma matriz que continua inteira no banco.
    return (
      <EmptyState
        icon={AlertTriangle}
        tone="danger"
        title="Não foi possível carregar as permissões"
        description={`${loadError} Nada foi alterado — a matriz continua como está no banco.`}
        action={<Button size="sm" onClick={() => void load()}>Tentar de novo</Button>}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* O <h1> sai do kit (regra 2 de docs/design-system.md): escrito à mão
          aqui, ele ficava em `text-xl` contra o `text-2xl sm:text-3xl` do resto
          do app. */}
      <PageHeader
        title="Permissões"
        eyebrow="Administração"
        icon={Shield}
        className="mb-0"
        description={
          <>
            Cada mudança grava na hora em <code>role_permissions</code> / <code>stage_permissions</code>.
            Administrador tem acesso total por construção e não aparece na matriz.
          </>
        }
      />

      {!isAdmin && (
        <p className="text-xs text-warning">
          Você está vendo a matriz em modo leitura — só administradores gravam
          (o banco recusa a escrita pelo RLS, não só a tela).
        </p>
      )}

      {/* Duas coisas que mudam o resultado de cada clique e não estavam
          escritas em lugar nenhum. */}
      <div className="rounded-lg border border-border/50 bg-secondary/20 p-3 text-xs text-muted-foreground space-y-1">
        <p>
          <strong className="text-foreground">Papel é N:N e a autorização usa a UNIÃO.</strong>{" "}
          Uma pessoa pode ser diretora, gerente e corretora ao mesmo tempo, e basta{" "}
          <em>um</em> dos papéis dela ter a permissão para ela passar. Além disso, todo perfil
          nasce com <code>Corretor</code> e esse papel não é retirado sozinho: desligar um
          switch da coluna Corretor não nega nada a quem tem outro papel, e nega a todos os
          demais de uma vez.
        </p>
        <p>
          <strong className="text-foreground">Quem já está logado só vê a mudança ao recarregar.</strong>{" "}
          A matriz é lida uma vez por sessão; conceder ou revogar agora vale imediatamente no
          banco, mas o menu e os botões da pessoa afetada só mudam no próximo F5 dela.
        </p>
      </div>

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
                    <th className="p-2 text-left font-medium text-muted-foreground">Onde vale</th>
                    {EDITABLE_ROLES.map((r) => (
                      <th key={r.value} className={cn("p-2 text-center font-medium", r.color)}>{r.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {menuPermissions.map((p) => (
                    <tr key={p.code} className="border-b border-border/10 hover:bg-primary/5">
                      <td className="p-2 font-medium">{p.label}</td>
                      <EnforcementCell code={p.code} />
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
          <p className="text-xs text-muted-foreground">
            Item de menu vale na tela (barra lateral e guard da rota) e, na maioria dos casos,
            o dado por trás continua sob o RLS de cada tabela. Onde a coluna "Onde vale" disser{" "}
            <strong>Aplicada no banco</strong>, conceder o item também libera dado — leia a frase
            ao lado antes de ligar.
          </p>
        </TabsContent>

        <TabsContent value="general" className="space-y-4 mt-4">
          {/* Gravar só muda algo quando alguém lê o código. A coluna "Onde vale"
              sai do mapa `featurePermissions` — sem ela o admin desligava um
              switch e acreditava ter negado algo. */}
          <p className="text-xs text-muted-foreground">
            <strong>Aplicada no banco</strong>: a policy ou RPC lê a permissão — é a trava de verdade.{" "}
            <strong>Aplicada na tela</strong>: só esconde o botão; quem barra é o RLS de cada tabela.{" "}
            <strong>Ainda sem efeito</strong>: nenhuma tela ou RPC lê este código por enquanto — gravar
            não muda nada, e por isso a linha vem SEM switch, com a frase de quem decide de verdade.
          </p>
          {featurePermissions.map(([category, items]) => (
            <Card key={category} className="border-border/50">
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/40">
                      <th className="p-2 text-left font-medium text-muted-foreground capitalize">{category}</th>
                      <th className="p-2 text-left font-medium text-muted-foreground">Onde vale</th>
                      {EDITABLE_ROLES.map((r) => (
                        <th key={r.value} className={cn("p-2 text-center font-medium", r.color)}>{r.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((p) => {
                      // Código sem leitor não ganha switch. O rótulo honesto
                      // ("Ainda sem efeito") reduzia o dano, mas não eliminava o
                      // clique: o admin desligava, a linha ia para
                      // `role_permissions` e ele saía acreditando ter negado
                      // algo. Sem controle, sobra a frase que diz quem decide.
                      const inerte = enforcementOf(p.code).enforcedBy === null;
                      return (
                        <tr key={p.code} className="border-b border-border/10 hover:bg-primary/5">
                          <td className="p-2">
                            <span className="font-medium">{p.label}</span>
                            {p.description && <span className="block text-xs text-muted-foreground">{p.description}</span>}
                          </td>
                          <EnforcementCell code={p.code} />
                          {inerte ? (
                            <td className="p-2 text-xs text-muted-foreground" colSpan={EDITABLE_ROLES.length}>
                              Sem controle porque não há o que controlar: ligar ou desligar não muda
                              nada. As linhas já gravadas continuam em <code>role_permissions</code> e
                              ninguém as consulta.
                            </td>
                          ) : (
                            EDITABLE_ROLES.map((r) => (
                              <td key={r.value} className="p-2 text-center">
                                <Switch
                                  aria-label={`${p.label} para ${r.label}`}
                                  checked={grants[key(r.value, p.code)] ?? false}
                                  onCheckedChange={() => toggleGrant(r.value, p.code)}
                                  disabled={!isAdmin || saving === key(r.value, p.code)}
                                />
                              </td>
                            ))
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="stages" className="space-y-4 mt-4">
          {/* Badge é <div>: como controle, ficava fora do Tab e sem estado
              exposto — quem usa teclado ou leitor de tela travava no papel
              padrão. O botão nativo resolve os dois (mesmo padrão de
              AdminAllowedIps). */}
          <div className="flex gap-2 flex-wrap mb-4" role="group" aria-label="Papel">
            {EDITABLE_ROLES.map((r) => (
              <button
                key={r.value}
                type="button"
                aria-pressed={selectedRole === r.value}
                className="rounded-full"
                onClick={() => setSelectedRole(r.value)}
              >
                <Badge
                  variant={selectedRole === r.value ? "default" : "outline"}
                  className={cn("cursor-pointer text-xs", selectedRole === r.value && "bg-primary")}
                >
                  {r.label}
                </Badge>
              </button>
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
                    <th className="p-3 text-left font-medium text-muted-foreground">Quem mais entra</th>
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
                        {/* Sem esta coluna a matriz só era legível um papel por
                            vez, e "ninguém entra nesta etapa" ficava invisível. */}
                        <td className="p-3 text-muted-foreground">
                          {entramNaEtapa(stage.id) || "ninguém além do administrador"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground">
            "Pode entrar" é o que <code>can_enter_stage()</code> lê ao mover um negócio e
            "Pode sair" é o que o gatilho <code>deals_guard_stage</code> lê ao tirá-lo dela.
            Linha ausente = negado: papel com tudo desligado aqui é configuração legítima,
            não configuração perdida. O administrador atravessa a matriz por construção.
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
