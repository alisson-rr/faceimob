import { useEffect, useId, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { describeError } from "@/lib/supabaseError";
import type { IntegrationRecord } from "@/integrations/supabase/integrations";
import {
  configureThreeC, listThreeCOptions, rotateThreeCToken, threeCConfig, threeCConfigProblem,
  type ThreeCConfig,
} from "@/integrations/supabase/threeC";

type Props = {
  integration?: IntegrationRecord;
  canManage: boolean;
  onChanged: () => Promise<void>;
  onRevoke: () => void;
};

export function ThreeCIntegrationSettings({ integration, canManage, onChanged, onRevoke }: Props) {
  const id = useId();
  const { toast } = useToast();
  const [config, setConfig] = useState(() => threeCConfig(integration));
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [brokers, setBrokers] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [outcomesText, setOutcomesText] = useState(() => threeCConfig(integration).outcomes.join(", "));
  const storedConfig = JSON.stringify(threeCConfig(integration));
  const configured = Boolean(integration?.has_secret && integration.active) || Boolean(newToken);
  const problem = threeCConfigProblem(config);
  const unavailableGroups = loading || error ? [] : config.allowed_group_ids.filter((groupId) => !groups.some((group) => group.id === groupId));
  const unavailableAgendas = loading || error ? [] : config.agenda_ids.filter((agendaId) => !brokers.some((broker) => broker.id === agendaId));

  useEffect(() => {
    const saved = threeCConfig({ config: JSON.parse(storedConfig) });
    setConfig(saved);
    setOutcomesText(saved.outcomes.join(", "));
  }, [storedConfig]);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const options = await listThreeCOptions();
        if (alive) { setGroups(options.groups); setBrokers(options.brokers); }
      } catch (e) {
        if (alive) setError(describeError(e, "Não foi possível carregar os grupos e as agendas."));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const patch = (values: Partial<ThreeCConfig>) => setConfig((current) => ({ ...current, ...values }));
  const refresh = async () => {
    try { await onChanged(); }
    catch { toast({ title: "Alteração salva", description: "Recarregue a tela para conferir o estado atualizado." }); }
  };
  const save = async () => {
    if (config.enabled && (problem || !configured)) return;
    setBusy(true);
    try {
      setConfig(await configureThreeC(config));
      toast({ variant: "success", title: "Configuração da 3C salva" });
      await refresh();
    } catch (e) {
      toast({ variant: "destructive", title: "Não foi possível salvar a configuração da 3C", description: describeError(e, "Tente de novo.") });
    } finally { setBusy(false); }
  };
  const rotate = async () => {
    setBusy(true);
    setNewToken(null);
    try {
      setNewToken(await rotateThreeCToken());
      await refresh();
    } catch (e) {
      toast({ variant: "destructive", title: "Não foi possível gerar a chave da 3C", description: describeError(e, "Tente de novo.") });
    } finally { setBusy(false); }
  };

  return (
    <Card role="group" aria-label="3C — agente de voz" className="border-border/50">
      <CardHeader className="px-4 py-3">
        <CardTitle className="flex items-center justify-between gap-2 text-sm">
          3C — agente de voz <Badge variant={configured ? "default" : "outline"}>{configured ? "chave no cofre" : "sem chave"}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 px-4 pb-4 text-sm">
        <p className="text-xs text-muted-foreground">Autorize os grupos de leads e as agendas que a 3C pode consultar e atualizar. As agendas são dos corretores; o grupo de entrada mantém a distribuição pela roleta.</p>
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Gere uma chave exclusiva e guarde-a em um gerenciador de senhas. Compartilhe pelo cofre seguro com a 3C. Ao substituir, a chave anterior deixa de valer.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!canManage || busy} onClick={() => void rotate()}>{configured ? "Gerar nova chave 3C" : "Gerar chave 3C"}</Button>
            {configured && <Button size="sm" variant="outline" disabled={!canManage || busy} onClick={() => { setNewToken(null); onRevoke(); }}>Revogar chave 3C</Button>}
          </div>
          {newToken && <div className="space-y-2 rounded-xl border border-warning/40 p-3">
            <Label htmlFor={`${id}-token`}>Chave nova — exibida somente agora</Label>
            <Input id={`${id}-token`} readOnly autoComplete="off" value={newToken} className="font-mono text-xs" />
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => {
                void (async () => {
                  try { await navigator.clipboard.writeText(newToken); toast({ title: "Chave copiada" }); }
                  catch { toast({ title: "Selecione a chave e copie manualmente", variant: "destructive" }); }
                })();
              }}>Copiar chave 3C</Button>
              <Button size="sm" variant="ghost" onClick={() => setNewToken(null)}>Já guardei a chave</Button>
            </div>
          </div>}
        </div>
        {loading && <p role="status" className="text-xs text-muted-foreground">Carregando grupos e agendas…</p>}
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        <fieldset disabled={!canManage || busy || loading || Boolean(error)} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor={`${id}-identity`}>Identidade da integração</Label>
            <Input id={`${id}-identity`} value={config.integration_user_id || "Criada pelo servidor ao salvar"} readOnly className="text-xs" />
          </div>
          {(unavailableGroups.length > 0 || unavailableAgendas.length > 0) && <div className="space-y-2 rounded-xl border border-warning/40 p-3">
            <p className="text-xs">Seleções indisponíveis: {unavailableGroups.length} {unavailableGroups.length === 1 ? "grupo" : "grupos"} e {unavailableAgendas.length} {unavailableAgendas.length === 1 ? "agenda" : "agendas"}. Remova essas seleções e revise a configuração antes de salvar.</p>
            <Button size="sm" variant="outline" onClick={() => {
              const selectedGroups = config.allowed_group_ids.filter((groupId) => !unavailableGroups.includes(groupId));
              patch({
                allowed_group_ids: selectedGroups,
                default_group_id: selectedGroups.includes(config.default_group_id || "") ? config.default_group_id : null,
                agenda_ids: config.agenda_ids.filter((agendaId) => !unavailableAgendas.includes(agendaId)),
              });
            }}>Remover seleções indisponíveis</Button>
          </div>}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Grupos de leads autorizados</legend>
            {groups.map((group) => <label key={group.id} className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={config.allowed_group_ids.includes(group.id)} onChange={(event) => {
                const selected = event.target.checked ? [...config.allowed_group_ids, group.id] : config.allowed_group_ids.filter((value) => value !== group.id);
                patch({ allowed_group_ids: selected, default_group_id: selected.includes(config.default_group_id || "") ? config.default_group_id : null });
              }} />{group.name}
            </label>)}
            {!loading && !groups.length && <p className="text-xs text-muted-foreground">Nenhum grupo disponível.</p>}
          </fieldset>
          <div className="space-y-1">
            <Label htmlFor={`${id}-default`}>Grupo de entrada de novos leads</Label>
            <select id={`${id}-default`} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={config.default_group_id || ""} onChange={(event) => patch({ default_group_id: event.target.value || null })}>
              <option value="">Selecione o grupo de entrada</option>
              {groups.filter((group) => config.allowed_group_ids.includes(group.id)).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Agendas de corretores autorizadas</legend>
            {brokers.map((broker) => <label key={broker.id} className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={config.agenda_ids.includes(broker.id)} onChange={(event) => patch({ agenda_ids: event.target.checked ? [...config.agenda_ids, broker.id] : config.agenda_ids.filter((value) => value !== broker.id) })} />{broker.name}
            </label>)}
            {!loading && !brokers.length && <p className="text-xs text-muted-foreground">Nenhuma agenda disponível.</p>}
          </fieldset>
          <div className="space-y-1">
            <Label htmlFor={`${id}-outcomes`}>Desfechos aceitos (separados por vírgula)</Label>
            <Input id={`${id}-outcomes`} value={outcomesText} onChange={(event) => {
              setOutcomesText(event.target.value);
              patch({ outcomes: event.target.value.split(",").map((value) => value.trim()) });
            }} />
          </div>
          <div className="flex items-center gap-3">
            <Switch id={`${id}-enabled`} checked={config.enabled} onCheckedChange={(enabled) => patch({ enabled })} disabled={!config.enabled && (Boolean(problem) || !configured)} />
            <Label htmlFor={`${id}-enabled`}>Integração 3C ativa</Label>
          </div>
          {(!configured || problem) && <p className="text-xs text-muted-foreground">Para ativar: {!configured ? "gere e guarde a chave da integração." : problem}</p>}
          <Button size="sm" disabled={config.enabled && (Boolean(problem) || !configured)} onClick={() => void save()}>{busy ? "Salvando…" : "Salvar configuração 3C"}</Button>
        </fieldset>
      </CardContent>
    </Card>
  );
}
