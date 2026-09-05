import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Plus, Trash2, Save, Zap, Timer, Users, Layers, PauseCircle, Settings2, FileText, UserCheck, Lock, ArrowUp, ArrowDown } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LoadingState } from "@/components/shared";
import { listPeople } from "@/integrations/supabase/newSchema";
import { useAuth } from "@/contexts/AuthContext";
import { describeError } from "@/lib/supabaseError";
import { slugify } from "@/lib/utils";

type Settings = {
  roleta_seconds: number;
  no_response_hours: number;
  inactivity_alert_hours: number;
  auto_first_contact: boolean;
  leads_paused: boolean;
  /** Quantos leads vencidos tiram o corretor da fila (lido por `distribution_queue`, 0014). */
  overdue_block_threshold: number;
  notify_on_assign: boolean;
  notify_on_timeout: boolean;
};

type Window = {
  id?: string;
  slot: string;
  label: string;
  checkin_start: string;
  distribution_start: string;
  checkout_time: string;
  /** Ordem dos turnos no dia. Sem gravar, todo turno novo nascia em 0 e a
   *  ordem entre eles ficava indefinida. */
  position: number;
  active: boolean;
};

type Broker = { id: string; name: string; active: boolean };
type FormRef = { form_id: string; form_name: string | null };
type Group = {
  id: string;
  name: string;
  active: boolean;
  /** 'general' é a fila para onde o SDR devolve o lead qualificado sem grupo
   *  próprio; 'sdr' é a triagem por IA. O banco recusa excluir a última geral. */
  kind: string;
  brokers: string[];      // broker ids
  forms: FormRef[];
};

const NO_PERMISSION = "Sem permissão: só o administrador altera a automação.";

/**
 * Piso de cada campo numérico das regras, com o que acontece se ele passar.
 * `min` espelha o `min` do input; para os dois primeiros o banco também tem
 * CHECK (> 0), para os dois de horas NÃO tem — e é justamente por isso que a
 * recusa precisa acontecer aqui, com o nome do campo.
 */
const REGRAS_NUMERICAS: Array<{
  campo: "roleta_seconds" | "no_response_hours" | "inactivity_alert_hours" | "overdue_block_threshold";
  rotulo: string;
  min: number;
  consequencia: string;
}> = [
  { campo: "roleta_seconds", rotulo: "Roleta (s)", min: 30, consequencia: "É o tempo que o corretor tem para atender antes de o lead voltar para a fila." },
  { campo: "no_response_hours", rotulo: "Sem resposta (h)", min: 1, consequencia: "Com 0 a varredura de leads sem resposta é desligada e ninguém é avisado no sino." },
  { campo: "inactivity_alert_hours", rotulo: "Inatividade (h)", min: 1, consequencia: "Com 0 nenhum lead é destacado como parado na lista." },
  { campo: "overdue_block_threshold", rotulo: "Vencidos p/ bloquear", min: 1, consequencia: "É quantos leads vencidos tiram o corretor da fila." },
];

/** `distribution_groups.kind` em português. Nenhuma tela criava 'general' nem
 *  'sdr' — o default da coluna é 'specific' —, e os dois têm consumidor:
 *  `sdr_handoff` e `assign_lead` caem na fila geral quando o lead não tem grupo. */
const KIND_LABEL: Record<string, string> = {
  general: "Fila geral",
  sdr: "Triagem SDR (IA)",
  specific: "Formulários específicos",
};

type WriteResult = { data: unknown[] | null; error: { code?: string; message?: string } | null };

/**
 * Escrita honesta. RLS que barra um update/delete devolve 0 linhas SEM erro
 * (o `using` filtra antes de o `with check` ser avaliado), e o supabase-js
 * entrega `error: null` — sem `.select()` e contagem, o toast de sucesso mente.
 * `byCode` traduz um código específico do Postgres (ex.: 23505) numa frase que
 * explica a regra em vez do genérico do `describeError`.
 */
async function wrote(q: PromiseLike<WriteResult>, fallback: string, byCode: Record<string, string> = {}) {
  const { data, error } = await q;
  if (error) {
    const description = (error.code && byCode[error.code]) || describeError(error, fallback);
    toast({ variant: "destructive", title: "Erro ao salvar", description });
    return false;
  }
  if (!data?.length) {
    toast({ variant: "destructive", title: NO_PERMISSION });
    return false;
  }
  return true;
}

export default function AdminLeadAutomation() {
  const { isAdmin, roles } = useAuth();
  // Espelha as policies da 0004: regras, turnos, grupos e formulários são
  // `is_admin()`; só os corretores do grupo aceitam diretor.
  const readOnly = !isAdmin;
  const canEditMembers = isAdmin || roles.includes("director");

  const [settings, setSettings] = useState<Settings>({
    roleta_seconds: 300,
    no_response_hours: 24,
    inactivity_alert_hours: 24,
    // Mesmo default da 0004: o Switch não pode nascer ligado e desligar sozinho
    // quando o banco responde.
    auto_first_contact: false,
    leads_paused: false,
    overdue_block_threshold: 3,
    notify_on_assign: true,
    notify_on_timeout: true,
  });

  const [loading, setLoading] = useState(true);
  const [windows, setWindows] = useState<Window[]>([]);
  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [detectedForms, setDetectedForms] = useState<FormRef[]>([]);
  const [savingSettings, setSavingSettings] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupDialog, setGroupDialog] = useState<{ mode: "create" | "rename"; id?: string; name: string; kind: string } | null>(null);
  /**
   * Exclusão pendente de confirmação. Era `confirm()` do navegador — que não
   * respeita o tema, não é alcançável por teste de tela e, no caso do grupo,
   * resumia em uma linha um efeito em cascata (corretores e formulários saem
   * junto) sem dizer QUANTOS. O número é o que decide se dá para excluir.
   */
  const [confirmando, setConfirmando] = useState<
    { tipo: "turno"; id: string; label: string } | { tipo: "grupo"; grupo: Group } | null
  >(null);
  const [formDialog, setFormDialog] = useState<{ groupId: string; form_id: string; form_name: string } | null>(null);
  const editingGroup = groups.find((g) => g.id === editingGroupId) || null;
  // União: o que o grupo já tem (inclusive form manual sem lead nenhum) na
  // frente, depois os demais detectados. Só `detectedForms` escondia o vínculo
  // manual e não deixava desmarcá-lo.
  const formOptions = editingGroup
    ? [...editingGroup.forms, ...detectedForms.filter((d) => !editingGroup.forms.some((f) => f.form_id === d.form_id))]
    : detectedForms;
  const groupOwning = (formId: string) => groups.find((g) => g.forms.some((f) => f.form_id === formId)) ?? null;

  const load = async () => {
    try {
      const [s, w, people, g, gb, gf, lf] = await Promise.all([
        supabase.from("automation_settings").select("*").eq("id", true).maybeSingle(),
        supabase.from("work_shifts").select("*").order("position"),
        listPeople(),
        supabase.from("distribution_groups").select("*").order("name"),
        supabase.from("distribution_group_members").select("*"),
        supabase.from("distribution_group_forms").select("*"),
        supabase.from("leads").select("form_id").not("form_id", "is", null).limit(1000),
      ]);
      const failed = [s, w, g, gb, gf, lf].find((r) => r.error);
      if (failed?.error) throw failed.error;

      if (s.data) {
        const row = s.data;
        setSettings((current) => ({
          ...current,
          roleta_seconds: row.attend_timeout_seconds,
          no_response_hours: row.no_response_hours,
          inactivity_alert_hours: row.inactivity_alert_hours,
          auto_first_contact: row.auto_first_contact,
          leads_paused: row.leads_paused,
          overdue_block_threshold: row.overdue_block_threshold,
          notify_on_assign: row.notify_on_assign,
          notify_on_timeout: row.notify_on_timeout,
        }));
      }
      setWindows((w.data ?? []).map((row, i) => ({ ...row, slot: row.code, position: row.position ?? i })));
      setBrokers(people.filter((person) => person.active && person.roles.includes("broker")));
      const links = gf.data ?? [];
      setGroups((g.data ?? []).map((row) => ({
        id: row.id, name: row.name, active: row.active, kind: row.kind,
        brokers: (gb.data ?? []).filter((x) => x.group_id === row.id && x.active).map((x) => x.profile_id),
        forms: links.filter((x) => x.group_id === row.id).map((x) => ({ form_id: x.form_id, form_name: x.form_name })),
      })));
      // O nome do formulário vive em distribution_group_forms (`leads` só tem
      // o id). Semear o mapa com ele é o que faz a lista mostrar nome em vez
      // do id numérico da Meta — e o que evita regravar `form_name = null`.
      const map = new Map<string, string | null>();
      links.forEach((x) => map.set(x.form_id, x.form_name));
      (lf.data ?? []).forEach((r) => { if (r.form_id && !map.has(r.form_id)) map.set(r.form_id, null); });
      setDetectedForms(Array.from(map.entries()).map(([form_id, form_name]) => ({ form_id, form_name })));
    } catch (error) {
      toast({ variant: "destructive", title: "Erro ao carregar", description: describeError(error, "Não foi possível carregar a automação de leads.") });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const saveSettings = async () => {
    // Validação na fronteira, ANTES de escrever. Campo limpo vira 0 no
    // `+e.target.value` e o `min` do input não vale nada (o Salvar é onClick,
    // não submit de form). `no_response_hours` e `inactivity_alert_hours` não
    // têm CHECK no banco, então o 0 entrava e DESLIGAVA a varredura em
    // silêncio — `mark_no_response_leads()` faz `if v_hours <= 0 then return`
    // — enquanto o texto de ajuda continuava prometendo o aviso no sino. Os
    // outros dois têm CHECK, e o erro genérico do banco ("um dos campos está
    // fora do valor permitido") não diz QUAL dos sete campos da linha errou.
    const invalido = REGRAS_NUMERICAS.find(({ campo, min }) => {
      const valor = settings[campo];
      return !Number.isFinite(valor) || valor < min;
    });
    if (invalido) {
      toast({
        variant: "destructive",
        title: `"${invalido.rotulo}" precisa ser no mínimo ${invalido.min}`,
        description: invalido.consequencia,
      });
      return;
    }
    setSavingSettings(true);
    const ok = await wrote(
      supabase.from("automation_settings")
        .update({
          attend_timeout_seconds: settings.roleta_seconds,
          no_response_hours: settings.no_response_hours,
          inactivity_alert_hours: settings.inactivity_alert_hours,
          auto_first_contact: settings.auto_first_contact,
          leads_paused: settings.leads_paused,
          overdue_block_threshold: settings.overdue_block_threshold,
          notify_on_assign: settings.notify_on_assign,
          notify_on_timeout: settings.notify_on_timeout,
        })
        .eq("id", true)
        .select("id"),
      "Não foi possível salvar as regras de automação.",
    );
    setSavingSettings(false);
    if (ok) toast({ title: "Automação salva" });
  };

  const upsertWindow = async (w: Window, idx: number) => {
    const payload = {
      active: w.active,
      checkin_start: w.checkin_start,
      checkout_time: w.checkout_time,
      code: w.slot,
      distribution_start: w.distribution_start,
      label: w.label,
      // `load()` ordena por `position` e nada a gravava: todo turno criado pela
      // tela nascia em 0 e a ordem entre os novos ficava indefinida.
      position: w.position ?? idx,
    };
    const ok = await wrote(
      w.id
        ? supabase.from("work_shifts").update(payload).eq("id", w.id).select("id")
        : supabase.from("work_shifts").insert(payload).select("id"),
      "Não foi possível salvar a janela de atendimento.",
      // `work_shifts_code_key`: dois turnos novos sem editar o Slot caíam aqui
      // com "Já existe um registro com esses dados", sem dizer qual campo.
      { "23505": "Já existe um turno com este Slot. Troque o campo Slot (id interno) antes de salvar." },
    );
    if (!ok) return;
    toast({ title: "Turno salvo" });
    load();
  };

  /**
   * Reordenar grava a posição de TODOS os turnos pelo índice novo. Trocar só o
   * par vizinho não resolveria a base atual, em que várias linhas têm
   * `position = 0` — a ordem entre elas continuaria por conta do Postgres.
   */
  const moveWindow = async (idx: number, dir: -1 | 1) => {
    const destino = idx + dir;
    if (destino < 0 || destino >= windows.length) return;
    const ordenados = [...windows];
    [ordenados[idx], ordenados[destino]] = [ordenados[destino], ordenados[idx]];
    const ids = ordenados.map((w) => w.id);
    if (ids.some((id) => !id)) {
      return toast({ variant: "destructive", title: "Salve o turno novo antes de reordenar." });
    }
    setWindows(ordenados.map((w, i) => ({ ...w, position: i })));
    for (const [i, id] of ids.entries()) {
      if (!id) continue;
      const ok = await wrote(
        supabase.from("work_shifts").update({ position: i }).eq("id", id).select("id"),
        "Não foi possível reordenar os turnos.",
      );
      if (!ok) break;
    }
    load();
  };

  const deleteWindow = async (id: string) => {
    setConfirmando(null);
    if (await wrote(supabase.from("work_shifts").delete().eq("id", id).select("id"), "Não foi possível excluir a janela de atendimento.")) load();
  };

  const addWindow = () => setWindows(ws => [...ws, {
    // Slot é UNIQUE: semear sempre "novo" fazia o segundo turno adicionado
    // morrer em 23505 na hora de salvar.
    slot: `turno_${ws.length + 1}`, label: "Nova janela",
    checkin_start: "09:00", distribution_start: "09:30", checkout_time: "12:00",
    position: ws.length,
    active: true,
  }]);

  // ── Distribution Groups ──
  // `prompt()` do navegador não tem rótulo, não valida nada, alguns webviews
  // simplesmente ignoram e o foco não volta para lugar nenhum. Trocado por
  // diálogo com Label/htmlFor — e, na criação, com o tipo do grupo, que nenhum
  // formulário do app preenchia (todo grupo nascia 'specific').
  const createGroup = async (name: string, kind: string) => {
    const ok = await wrote(
      supabase.from("distribution_groups").insert({ name, slug: slugify(name), kind, active: true }).select("id"),
      "Não foi possível criar o grupo de distribuição.",
      { "23505": "Já existe um grupo com esse nome." },
    );
    if (ok) { setGroupDialog(null); load(); }
  };
  const renameGroup = async (id: string, name: string) => {
    const ok = await wrote(
      supabase.from("distribution_groups").update({ name }).eq("id", id).select("id"),
      "Não foi possível renomear o grupo.",
      { "23505": "Já existe um grupo com esse nome." },
    );
    if (ok) { setGroupDialog(null); load(); }
  };
  const salvarGrupo = async () => {
    const nome = groupDialog?.name.trim();
    if (!groupDialog || !nome) return;
    if (groupDialog.mode === "create") return createGroup(nome, groupDialog.kind);
    if (nome === groups.find((g) => g.id === groupDialog.id)?.name) return setGroupDialog(null);
    if (groupDialog.id) return renameGroup(groupDialog.id, nome);
  };
  const salvarFormManual = async () => {
    const id = formDialog?.form_id.trim();
    if (!formDialog || !id) return;
    await addGroupForm(formDialog.groupId, id, formDialog.form_name.trim() || null);
    setFormDialog(null);
  };
  const toggleGroup = async (id: string, active: boolean) => {
    if (await wrote(supabase.from("distribution_groups").update({ active }).eq("id", id).select("id"), "Não foi possível alterar o grupo.")) load();
  };
  const deleteGroup = async (id: string) => {
    setConfirmando(null);
    // A última fila geral ativa é recusada pelo banco (trigger da 0064): é para
    // ela que o SDR devolve o lead qualificado e para onde `assign_lead` cai
    // quando o lead não tem grupo. A mensagem do P0001 já explica.
    if (await wrote(supabase.from("distribution_groups").delete().eq("id", id).select("id"), "Não foi possível excluir o grupo.")) load();
  };
  const toggleGroupBroker = async (groupId: string, brokerId: string, on: boolean) => {
    const ok = await wrote(
      on
        ? supabase.from("distribution_group_members").upsert({ group_id: groupId, profile_id: brokerId, active: true }).select("profile_id")
        : supabase.from("distribution_group_members").delete().eq("group_id", groupId).eq("profile_id", brokerId).select("profile_id"),
      on ? "Não foi possível incluir o corretor no grupo." : "Não foi possível remover o corretor do grupo.",
    );
    if (ok) load();
  };
  const addGroupForm = async (groupId: string, formId: string, form_name: string | null) => {
    const form_id = formId.trim();
    if (!form_id) return;
    const ok = await wrote(
      supabase.from("distribution_group_forms").insert({ group_id: groupId, form_id, form_name }).select("form_id"),
      "Não foi possível vincular o formulário ao grupo.",
      // Índice único global em form_id (0004): um formulário alimenta uma roleta só.
      { "23505": "Este formulário já pertence a outro grupo. Remova-o de lá antes." },
    );
    if (ok) load();
  };
  const removeGroupForm = async (groupId: string, formId: string) => {
    if (await wrote(supabase.from("distribution_group_forms").delete().eq("group_id", groupId).eq("form_id", formId).select("form_id"), "Não foi possível desvincular o formulário.")) load();
  };
  const togglePause = async (v: boolean) => {
    const previous = settings.leads_paused;
    setSettings((s) => ({ ...s, leads_paused: v }));
    const ok = await wrote(
      supabase.from("automation_settings").update({ leads_paused: v }).eq("id", true).select("id"),
      v ? "Não foi possível pausar a chegada de leads." : "Não foi possível retomar a chegada de leads.",
    );
    if (!ok) return setSettings((s) => ({ ...s, leads_paused: previous }));
    toast({ title: v ? "Chegada de leads pausada" : "Chegada de leads retomada" });
  };

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Zap className="h-5 w-5" /> Automação de Leads</h1>
        <p className="text-sm text-muted-foreground">Configure roleta, grupos de distribuição e regras automáticas.</p>
      </div>

      {readOnly && (
        <p role="status" className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <Lock className="h-4 w-4 shrink-0" />
          Somente o administrador altera regras, turnos, grupos e formulários — a tela está em modo de consulta.
          {canEditMembers && " Como diretor, você pode ajustar os corretores de cada grupo."}
        </p>
      )}

      {/* Pause switch */}
      <Card className={settings.leads_paused ? "border-warning/60 bg-warning/5" : ""}>
        <CardContent className="flex items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-3">
            <PauseCircle className={`h-6 w-6 ${settings.leads_paused ? "text-warning" : "text-muted-foreground"}`} />
            <div>
              <Label htmlFor="leads-paused" className="font-semibold text-sm">Pausar chegada de leads</Label>
              <p className="text-xs text-muted-foreground">
                {settings.leads_paused
                  ? "Os leads recebidos pelo Meta Ads estão sendo ignorados. Ative novamente para retomar."
                  : "Ative para bloquear temporariamente novos leads (útil durante ajustes no app)."}
              </p>
            </div>
          </div>
          <Switch id="leads-paused" checked={settings.leads_paused} onCheckedChange={togglePause} disabled={readOnly} />
        </CardContent>
      </Card>

      {/* Automation rules — compact single row */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm"><Timer className="h-4 w-4" /> Regras & Tempos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
            <div className="space-y-1">
              <Label htmlFor="roleta-seconds" className="text-xs">Roleta (s)</Label>
              <Input id="roleta-seconds" className="h-8" type="number" min={30} value={settings.roleta_seconds} disabled={readOnly}
                onChange={e => setSettings(s => ({ ...s, roleta_seconds: +e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="no-response-hours" className="text-xs">Sem resposta (h)</Label>
              <Input id="no-response-hours" className="h-8" type="number" min={1} value={settings.no_response_hours} disabled={readOnly}
                onChange={e => setSettings(s => ({ ...s, no_response_hours: +e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="inactivity-hours" className="text-xs">Inatividade (h)</Label>
              <Input id="inactivity-hours" className="h-8" type="number" min={1} value={settings.inactivity_alert_hours} disabled={readOnly}
                onChange={e => setSettings(s => ({ ...s, inactivity_alert_hours: +e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="overdue-threshold" className="text-xs">Vencidos p/ bloquear</Label>
              <Input id="overdue-threshold" className="h-8" type="number" min={1} value={settings.overdue_block_threshold} disabled={readOnly}
                onChange={e => setSettings(s => ({ ...s, overdue_block_threshold: +e.target.value }))} />
            </div>
            <div className="flex items-center gap-2">
              <Switch id="auto-first-contact" checked={settings.auto_first_contact} disabled={readOnly}
                onCheckedChange={v => setSettings(s => ({ ...s, auto_first_contact: v }))} />
              <Label htmlFor="auto-first-contact" className="text-xs">Auto 1º contato</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="notify-on-assign" checked={settings.notify_on_assign} disabled={readOnly}
                onCheckedChange={v => setSettings(s => ({ ...s, notify_on_assign: v }))} />
              <Label htmlFor="notify-on-assign" className="text-xs">Avisar ao receber lead</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="notify-on-timeout" checked={settings.notify_on_timeout} disabled={readOnly}
                onCheckedChange={v => setSettings(s => ({ ...s, notify_on_timeout: v }))} />
              <Label htmlFor="notify-on-timeout" className="text-xs">Avisar lead vencido</Label>
            </div>
            {!readOnly && (
              <Button size="sm" onClick={saveSettings} disabled={savingSettings || loading} className="h-8">
                <Save className="h-3.5 w-3.5 mr-1" /> {savingSettings ? "..." : "Salvar"}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            <strong>Sem resposta:</strong> lead parado em Primeiro Contato por essas horas vai para Sem Resposta e o corretor é avisado no sino.{" "}
            <strong>Inatividade:</strong> destaca na lista o lead sem movimento há essas horas.{" "}
            <strong>Auto 1º contato:</strong> ao clicar em Atender, o lead entra direto em Primeiro Contato.{" "}
            <strong>Vencidos p/ bloquear:</strong> com essa quantidade de leads vencidos em aberto, o corretor sai da fila até atender.{" "}
            <strong>Avisos:</strong> desligam a notificação de lead recebido e a de lead vencido para todos os corretores.
          </p>
        </CardContent>
      </Card>

      {/* Distribution GROUPS (brokers + forms) */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base"><Layers className="h-4 w-4" /> Grupos de Distribuição</CardTitle>
          {!readOnly && (
            <Button size="sm" onClick={() => setGroupDialog({ mode: "create", name: "", kind: "specific" })}>
              <Plus className="h-4 w-4 mr-1" /> Novo grupo
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && <LoadingState variant="list" rows={3} label="Carregando grupos de distribuição…" />}
          {!loading && groups.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Crie grupos para direcionar leads de formulários específicos a corretores específicos. A fila dentro do grupo segue a ordem de check-in.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((g) => (
              <div
                key={g.id}
                className={`p-4 rounded-lg border transition-colors ${
                  g.active ? "border-border/60 bg-card" : "border-border/40 bg-muted/30 opacity-70"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">{g.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {g.active ? "Ativo" : "Inativo"} · {KIND_LABEL[g.kind] ?? g.kind}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Switch aria-label={`Grupo ${g.name} ativo`} checked={g.active} disabled={readOnly} onCheckedChange={(v) => toggleGroup(g.id, v)} />
                    {!readOnly && (
                      <>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setGroupDialog({ mode: "rename", id: g.id, name: g.name, kind: g.kind })} title="Renomear" aria-label={`Renomear ${g.name}`}>
                          <Settings2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => setConfirmando({ tipo: "grupo", grupo: g })} title="Excluir" aria-label={`Excluir ${g.name}`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <div className="rounded-md bg-muted/40 p-2 text-center">
                    <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                      <UserCheck className="h-3 w-3" /> Corretores
                    </div>
                    <p className="text-lg font-bold leading-tight">{g.brokers.length}</p>
                  </div>
                  <div className="rounded-md bg-muted/40 p-2 text-center">
                    <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                      <FileText className="h-3 w-3" /> Formulários
                    </div>
                    <p className="text-lg font-bold leading-tight">{g.forms.length}</p>
                  </div>
                </div>
                <Button size="sm" variant="outline" className="w-full mt-3 h-8 text-xs" onClick={() => setEditingGroupId(g.id)} aria-label={`Configurar ${g.name}`}>
                  <Settings2 className="h-3.5 w-3.5 mr-1" /> Configurar
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Group editor dialog */}
      <Dialog open={!!editingGroup} onOpenChange={(v) => !v && setEditingGroupId(null)}>
        {/* max-h + overflow: no celular as duas listas empilham e o rodapé sairia da viewport. */}
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="h-4 w-4" /> {editingGroup?.name}
            </DialogTitle>
          </DialogHeader>
          {editingGroup && (
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  {/* Cabeçalho de lista, não rótulo de controle: `<Label>` sem
                      `htmlFor` fica órfão para o leitor de tela. */}
                  <h3 className="text-xs font-semibold flex items-center gap-1">
                    <UserCheck className="h-3.5 w-3.5" aria-hidden /> Corretores
                  </h3>
                  <Badge variant="secondary">{editingGroup.brokers.length} selecionados</Badge>
                </div>
                <ScrollArea className="h-72 rounded border border-border/60 p-2">
                  <div className="space-y-1">
                    {brokers.map((b) => {
                      const on = editingGroup.brokers.includes(b.id);
                      return (
                        <label key={b.id} className="flex items-center gap-2 text-sm px-2 py-1 rounded hover:bg-muted/50 cursor-pointer">
                          <Checkbox checked={on} disabled={!canEditMembers} onCheckedChange={(v) => toggleGroupBroker(editingGroup.id, b.id, !!v)} />
                          <span className="truncate">{b.name}</span>
                        </label>
                      );
                    })}
                    {brokers.length === 0 && <p className="text-xs text-muted-foreground p-2">Nenhum corretor ativo.</p>}
                  </div>
                </ScrollArea>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold flex items-center gap-1">
                    <FileText className="h-3.5 w-3.5" aria-hidden /> Formulários Meta
                  </h3>
                  <Badge variant="secondary">{editingGroup.forms.length} selecionados</Badge>
                </div>
                <ScrollArea className="h-72 rounded border border-border/60 p-2">
                  <div className="space-y-1">
                    {formOptions.map((d) => {
                      const on = editingGroup.forms.some((f) => f.form_id === d.form_id);
                      const owner = on ? null : groupOwning(d.form_id);
                      return (
                        <label key={d.form_id} className="flex items-center gap-2 text-sm px-2 py-1 rounded hover:bg-muted/50 cursor-pointer">
                          <Checkbox
                            checked={on}
                            disabled={readOnly}
                            onCheckedChange={(v) => {
                              if (v) addGroupForm(editingGroup.id, d.form_id, d.form_name);
                              else removeGroupForm(editingGroup.id, d.form_id);
                            }}
                          />
                          <span className="truncate flex-1">{d.form_name || d.form_id}</span>
                          {d.form_name && <span className="text-xs text-muted-foreground truncate">{d.form_id}</span>}
                          {owner && <span className="text-xs text-warning truncate">grupo: {owner.name}</span>}
                        </label>
                      );
                    })}
                    {formOptions.length === 0 && (
                      <p className="text-xs text-muted-foreground p-2">Nenhum formulário detectado ainda. Use "Adicionar form manual" abaixo.</p>
                    )}
                  </div>
                </ScrollArea>
                {!readOnly && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-full mt-2 h-7 text-xs"
                    onClick={() => setFormDialog({ groupId: editingGroup.id, form_id: "", form_name: "" })}
                  >
                    <Plus className="h-3 w-3 mr-1" /> Adicionar form manual
                  </Button>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingGroupId(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Nome do grupo — e, na criação, o tipo. Substitui dois `prompt()`. */}
      <Dialog open={!!groupDialog} onOpenChange={(v) => !v && setGroupDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{groupDialog?.mode === "create" ? "Novo grupo de distribuição" : "Renomear grupo"}</DialogTitle>
          </DialogHeader>
          {groupDialog && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="grupo-nome" className="text-xs">Nome do grupo</Label>
                <Input
                  id="grupo-nome"
                  autoFocus
                  value={groupDialog.name}
                  onChange={(e) => setGroupDialog({ ...groupDialog, name: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") salvarGrupo(); }}
                />
              </div>
              {groupDialog.mode === "create" && (
                <div className="space-y-1">
                  <Label htmlFor="grupo-tipo" className="text-xs">Tipo</Label>
                  <Select value={groupDialog.kind} onValueChange={(v) => setGroupDialog({ ...groupDialog, kind: v })}>
                    <SelectTrigger id="grupo-tipo" aria-label="Tipo do grupo"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="specific">Formulários específicos</SelectItem>
                      <SelectItem value="general">Fila geral (recebe lead sem grupo próprio)</SelectItem>
                      <SelectItem value="sdr">Triagem SDR (IA)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    A <strong>fila geral</strong> é para onde o lead volta quando o SDR qualifica sem grupo de destino.
                    Deve existir uma ativa — o banco recusa excluir a última.
                  </p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setGroupDialog(null)}>Cancelar</Button>
            <Button onClick={salvarGrupo} disabled={!groupDialog?.name.trim()}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Formulário da Meta vinculado à mão. */}
      <Dialog open={!!formDialog} onOpenChange={(v) => !v && setFormDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Vincular formulário da Meta</DialogTitle>
          </DialogHeader>
          {formDialog && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="form-id" className="text-xs">ID do formulário (form_id)</Label>
                <Input
                  id="form-id"
                  autoFocus
                  value={formDialog.form_id}
                  onChange={(e) => setFormDialog({ ...formDialog, form_id: e.target.value })}
                  placeholder="Ex.: 1234567890123456"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="form-nome" className="text-xs">Nome do formulário (opcional)</Label>
                <Input
                  id="form-nome"
                  value={formDialog.form_name}
                  onChange={(e) => setFormDialog({ ...formDialog, form_name: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") salvarFormManual(); }}
                  placeholder="Como aparece no painel da Meta"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Um formulário alimenta uma roleta só: se já pertencer a outro grupo, o vínculo é recusado.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormDialog(null)}>Cancelar</Button>
            <Button onClick={salvarFormManual} disabled={!formDialog?.form_id.trim()}>Vincular</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Distribution windows (shifts) */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4" /> Janelas de Atendimento (turnos)</CardTitle>
          {!readOnly && <Button size="sm" onClick={addWindow}><Plus className="h-4 w-4 mr-1" /> Adicionar</Button>}
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && <LoadingState variant="list" rows={2} label="Carregando turnos…" />}
          {!loading && windows.length === 0 && <p className="text-sm text-muted-foreground">Nenhum turno configurado.</p>}
          {windows.map((w, idx) => (
            <div key={w.id || `new-${idx}`} className="grid md:grid-cols-[1fr_1fr_auto_auto_auto_auto_auto] gap-2 items-end p-3 rounded-lg border border-border/60">
              <div className="space-y-1">
                <Label htmlFor={`turno-${idx}-slot`} className="text-xs">Slot (id interno)</Label>
                <Input id={`turno-${idx}-slot`} value={w.slot} disabled={readOnly} onChange={e => setWindows(ws => ws.map((x, i) => i === idx ? { ...x, slot: e.target.value } : x))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`turno-${idx}-nome`} className="text-xs">Nome</Label>
                <Input id={`turno-${idx}-nome`} value={w.label} disabled={readOnly} onChange={e => setWindows(ws => ws.map((x, i) => i === idx ? { ...x, label: e.target.value } : x))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`turno-${idx}-checkin`} className="text-xs">Check-in</Label>
                <Input id={`turno-${idx}-checkin`} type="time" value={w.checkin_start.slice(0,5)} disabled={readOnly} onChange={e => setWindows(ws => ws.map((x, i) => i === idx ? { ...x, checkin_start: e.target.value + ":00" } : x))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`turno-${idx}-distribuicao`} className="text-xs">Início distrib.</Label>
                <Input id={`turno-${idx}-distribuicao`} type="time" value={w.distribution_start.slice(0,5)} disabled={readOnly} onChange={e => setWindows(ws => ws.map((x, i) => i === idx ? { ...x, distribution_start: e.target.value + ":00" } : x))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`turno-${idx}-checkout`} className="text-xs">Checkout</Label>
                <Input id={`turno-${idx}-checkout`} type="time" value={w.checkout_time.slice(0,5)} disabled={readOnly} onChange={e => setWindows(ws => ws.map((x, i) => i === idx ? { ...x, checkout_time: e.target.value + ":00" } : x))} />
              </div>
              <div className="flex flex-col items-center gap-1">
                {/* `htmlFor` casando com o `id` do Switch: sem ele o rótulo
                    ficava solto — clicar não fazia nada e o leitor de tela
                    anunciava um "Ativo" sem dono. */}
                <Label htmlFor={`turno-${idx}-ativo`} className="text-xs">Ativo</Label>
                <Switch id={`turno-${idx}-ativo`} aria-label={`Turno ${w.label} ativo`} checked={w.active} disabled={readOnly} onCheckedChange={v => setWindows(ws => ws.map((x, i) => i === idx ? { ...x, active: v } : x))} />
              </div>
              {!readOnly && (
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" disabled={idx === 0} onClick={() => moveWindow(idx, -1)} aria-label={`Subir turno ${w.label}`}><ArrowUp className="h-4 w-4" /></Button>
                  <Button size="sm" variant="outline" disabled={idx === windows.length - 1} onClick={() => moveWindow(idx, 1)} aria-label={`Descer turno ${w.label}`}><ArrowDown className="h-4 w-4" /></Button>
                  <Button size="sm" onClick={() => upsertWindow(w, idx)} aria-label={`Salvar turno ${w.label}`}><Save className="h-4 w-4" /></Button>
                  {w.id && <Button size="sm" variant="destructive" onClick={() => setConfirmando({ tipo: "turno", id: w.id!, label: w.label })} aria-label={`Excluir turno ${w.label}`}><Trash2 className="h-4 w-4" /></Button>}
                </div>
              )}
              {w.id && <Badge variant="outline" className="md:col-span-7 w-fit">id: {w.id}</Badge>}
            </div>
          ))}
        </CardContent>
      </Card>

      <AlertDialog open={!!confirmando} onOpenChange={(aberto) => { if (!aberto) setConfirmando(null); }}>
        <AlertDialogContent>
          {confirmando?.tipo === "grupo" ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir o grupo “{confirmando.grupo.name}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  {/* O efeito em cascata, com número: são estes vínculos que
                      saem junto (distribution_group_members e
                      distribution_group_forms, ON DELETE CASCADE). */}
                  Saem junto <b>{confirmando.grupo.brokers.length} corretor(es)</b> e{" "}
                  <b>{confirmando.grupo.forms.length} formulário(s)</b> vinculados. Os formulários voltam a não
                  pertencer a roleta nenhuma: o lead que chegar por eles cai na fila geral.
                  {confirmando.grupo.kind === "general" && (
                    <> Este é um grupo <b>geral</b> — se for o último ativo, o banco recusa a exclusão, porque é para
                      ele que o SDR devolve o lead qualificado.</>
                  )}
                  {" "}Para tirá-lo de circulação sem perder os vínculos, desligue o grupo em vez de excluir.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={() => deleteGroup(confirmando.grupo.id)}>Excluir grupo</AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : confirmando ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir o turno “{confirmando.label}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  O check-in só vale dentro da janela de um turno: sem ele, ninguém entra na fila naquele horário e a
                  roleta não distribui. Os check-ins já feitos continuam gravados. Para suspender o horário sem
                  excluir, desmarque “Ativo” e salve.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={() => deleteWindow(confirmando.id)}>Excluir turno</AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
