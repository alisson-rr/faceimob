import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Plus, Trash2, Save, Zap, Timer, Users, Layers, PauseCircle, Settings2, FileText, UserCheck } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";

type Settings = {
  roleta_seconds: number;
  no_response_hours: number;
  inactivity_alert_hours: number;
  auto_first_contact: boolean;
  leads_paused: boolean;
  stage_max_minutes: Record<string, number>;
};

const STAGE_LABELS: { key: string; label: string }[] = [
  { key: "new", label: "Novo Lead" },
  { key: "first_contact", label: "Primeiro Contato" },
  { key: "no_response", label: "Sem Resposta" },
  { key: "warm", label: "Lead Morno" },
  { key: "hot", label: "Lead Quente" },
  { key: "gathering_docs", label: "Juntando Doc" },
];


type Window = {
  id?: string;
  slot: string;
  label: string;
  checkin_start: string;
  distribution_start: string;
  checkout_time: string;
  active: boolean;
};

type Broker = { id: string; name: string; active: boolean };
type Group = {
  id: string;
  name: string;
  active: boolean;
  brokers: string[];      // broker ids
  forms: { form_id: string; form_name: string | null }[];
};

export default function AdminLeadAutomation() {
  const [settings, setSettings] = useState<Settings>({
    roleta_seconds: 300,
    no_response_hours: 24,
    inactivity_alert_hours: 24,
    auto_first_contact: true,
    leads_paused: false,
    stage_max_minutes: { new: 5, first_contact: 60, no_response: 1440, warm: 2880, hot: 1440, gathering_docs: 4320 },
  });

  const [windows, setWindows] = useState<Window[]>([]);
  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [detectedForms, setDetectedForms] = useState<{ form_id: string; form_name: string | null }[]>([]);
  const [savingSettings, setSavingSettings] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const editingGroup = groups.find((g) => g.id === editingGroupId) || null;

  const load = async () => {
    const [{ data: s }, { data: w }, { data: b }, { data: g }, { data: gb }, { data: gf }, { data: lf }] = await Promise.all([
      supabase.from("lead_automation_settings").select("*").eq("id", true).maybeSingle(),
      supabase.from("distribution_windows").select("*").order("distribution_start"),
      supabase.from("brokers").select("id,name,active").eq("active", true).order("name"),
      supabase.from("distribution_groups" as any).select("*").order("name"),
      supabase.from("distribution_group_brokers" as any).select("*"),
      supabase.from("distribution_group_forms" as any).select("*"),
      supabase.from("leads").select("form_id, form_name").not("form_id", "is", null).limit(1000),
    ]);
    if (s) setSettings(s as any);
    setWindows((w as any) || []);
    setBrokers((b as any) || []);
    setGroups(((g as any[]) || []).map((row) => ({
      id: row.id, name: row.name, active: row.active,
      brokers: ((gb as any[]) || []).filter((x) => x.group_id === row.id).map((x) => x.broker_id),
      forms: ((gf as any[]) || []).filter((x) => x.group_id === row.id).map((x) => ({ form_id: x.form_id, form_name: x.form_name })),
    })));
    const map = new Map<string, string | null>();
    ((lf as any[]) || []).forEach((r) => { if (r.form_id && !map.has(r.form_id)) map.set(r.form_id, r.form_name || null); });
    setDetectedForms(Array.from(map.entries()).map(([form_id, form_name]) => ({ form_id, form_name })));
  };

  useEffect(() => { load(); }, []);

  const saveSettings = async () => {
    setSavingSettings(true);
    const { error } = await supabase.from("lead_automation_settings")
      .update({ ...settings, updated_at: new Date().toISOString() }).eq("id", true);
    setSavingSettings(false);
    if (error) return toast({ variant: "destructive", title: "Erro", description: error.message });
    toast({ title: "Automação salva" });
  };

  const upsertWindow = async (w: Window) => {
    const payload: any = { ...w };
    delete payload.created_at; delete payload.updated_at;
    const { error } = w.id
      ? await supabase.from("distribution_windows").update(payload).eq("id", w.id)
      : await supabase.from("distribution_windows").insert(payload);
    if (error) return toast({ variant: "destructive", title: "Erro", description: error.message });
    toast({ title: "Grupo salvo" });
    load();
  };

  const deleteWindow = async (id: string) => {
    if (!confirm("Excluir este grupo?")) return;
    const { error } = await supabase.from("distribution_windows").delete().eq("id", id);
    if (error) return toast({ variant: "destructive", title: "Erro", description: error.message });
    load();
  };

  const addWindow = () => setWindows(ws => [...ws, {
    slot: "novo", label: "Nova janela",
    checkin_start: "09:00", distribution_start: "09:30", checkout_time: "12:00",
    active: true,
  }]);

  // ── Distribution Groups ──
  const createGroup = async () => {
    const name = prompt("Nome do grupo:");
    if (!name) return;
    const { error } = await supabase.from("distribution_groups" as any).insert({ name, active: true });
    if (error) return toast({ variant: "destructive", title: "Erro", description: error.message });
    load();
  };
  const renameGroup = async (id: string, current: string) => {
    const name = prompt("Novo nome:", current);
    if (!name || name === current) return;
    await supabase.from("distribution_groups" as any).update({ name }).eq("id", id);
    load();
  };
  const toggleGroup = async (id: string, active: boolean) => {
    await supabase.from("distribution_groups" as any).update({ active }).eq("id", id);
    load();
  };
  const deleteGroup = async (id: string) => {
    if (!confirm("Excluir grupo?")) return;
    await supabase.from("distribution_groups" as any).delete().eq("id", id);
    load();
  };
  const toggleGroupBroker = async (groupId: string, brokerId: string, on: boolean) => {
    if (on) {
      await supabase.from("distribution_group_brokers" as any).insert({ group_id: groupId, broker_id: brokerId });
    } else {
      await supabase.from("distribution_group_brokers" as any).delete().eq("group_id", groupId).eq("broker_id", brokerId);
    }
    load();
  };
  const addGroupForm = async (groupId: string, form_id: string, form_name: string | null) => {
    if (!form_id) return;
    await supabase.from("distribution_group_forms" as any).insert({ group_id: groupId, form_id, form_name });
    load();
  };
  const togglePause = async (v: boolean) => {
    setSettings((s) => ({ ...s, leads_paused: v }));
    const { error } = await supabase.from("lead_automation_settings")
      .update({ leads_paused: v, updated_at: new Date().toISOString() } as any).eq("id", true);
    if (error) return toast({ variant: "destructive", title: "Erro", description: error.message });
    toast({ title: v ? "⏸️ Chegada de leads pausada" : "▶️ Chegada de leads retomada" });
  };
  const removeGroupForm = async (groupId: string, formId: string) => {
    await supabase.from("distribution_group_forms" as any).delete().eq("group_id", groupId).eq("form_id", formId);
    load();
  };

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Zap className="h-5 w-5" /> Automação de Leads</h1>
        <p className="text-sm text-muted-foreground">Configure roleta, grupos de distribuição e regras automáticas.</p>
      </div>

      {/* Pause switch */}
      <Card className={settings.leads_paused ? "border-amber-500/60 bg-amber-500/5" : ""}>
        <CardContent className="flex items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-3">
            <PauseCircle className={`h-6 w-6 ${settings.leads_paused ? "text-amber-500" : "text-muted-foreground"}`} />
            <div>
              <p className="font-semibold text-sm">Pausar chegada de leads</p>
              <p className="text-xs text-muted-foreground">
                {settings.leads_paused
                  ? "Os leads recebidos pelo Meta Ads estão sendo ignorados. Ative novamente para retomar."
                  : "Ative para bloquear temporariamente novos leads (útil durante ajustes no app)."}
              </p>
            </div>
          </div>
          <Switch checked={settings.leads_paused} onCheckedChange={togglePause} />
        </CardContent>
      </Card>

      {/* Automation rules — compact single row */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm"><Timer className="h-4 w-4" /> Regras & Tempos</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
          <div className="space-y-1">
            <Label className="text-[11px]">Roleta (s)</Label>
            <Input className="h-8" type="number" min={30} value={settings.roleta_seconds}
              onChange={e => setSettings(s => ({ ...s, roleta_seconds: +e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Sem resposta (h)</Label>
            <Input className="h-8" type="number" min={1} value={settings.no_response_hours}
              onChange={e => setSettings(s => ({ ...s, no_response_hours: +e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Inatividade (h)</Label>
            <Input className="h-8" type="number" min={1} value={settings.inactivity_alert_hours}
              onChange={e => setSettings(s => ({ ...s, inactivity_alert_hours: +e.target.value }))} />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={settings.auto_first_contact}
              onCheckedChange={v => setSettings(s => ({ ...s, auto_first_contact: v }))} />
            <Label className="text-[11px]">Auto 1º contato</Label>
          </div>
          <Button size="sm" onClick={saveSettings} disabled={savingSettings} className="h-8">
            <Save className="h-3.5 w-3.5 mr-1" /> {savingSettings ? "..." : "Salvar"}
          </Button>
        </CardContent>
      </Card>

      {/* Stage max times — compact grid */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm"><Timer className="h-4 w-4" /> Tempo máx. por etapa (min)</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 md:grid-cols-6 gap-2 items-end">
          {STAGE_LABELS.map(st => (
            <div key={st.key} className="space-y-1">
              <Label className="text-[10px]">{st.label}</Label>
              <Input className="h-8" type="number" min={1}
                value={settings.stage_max_minutes?.[st.key] ?? 0}
                onChange={e => setSettings(s => ({
                  ...s,
                  stage_max_minutes: { ...(s.stage_max_minutes || {}), [st.key]: +e.target.value },
                }))} />
            </div>
          ))}
        </CardContent>
      </Card>



      {/* Distribution GROUPS (brokers + forms) */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base"><Layers className="h-4 w-4" /> Grupos de Distribuição</CardTitle>
          <Button size="sm" onClick={createGroup}><Plus className="h-4 w-4 mr-1" /> Novo grupo</Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {groups.length === 0 && (
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
                    <p className="text-[10px] text-muted-foreground">{g.active ? "Ativo" : "Inativo"}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Switch checked={g.active} onCheckedChange={(v) => toggleGroup(g.id, v)} />
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => renameGroup(g.id, g.name)} title="Renomear">
                      <Settings2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => deleteGroup(g.id)} title="Excluir">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <div className="rounded-md bg-muted/40 p-2 text-center">
                    <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
                      <UserCheck className="h-3 w-3" /> Corretores
                    </div>
                    <p className="text-lg font-bold leading-tight">{g.brokers.length}</p>
                  </div>
                  <div className="rounded-md bg-muted/40 p-2 text-center">
                    <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
                      <FileText className="h-3 w-3" /> Formulários
                    </div>
                    <p className="text-lg font-bold leading-tight">{g.forms.length}</p>
                  </div>
                </div>
                <Button size="sm" variant="outline" className="w-full mt-3 h-8 text-xs" onClick={() => setEditingGroupId(g.id)}>
                  <Settings2 className="h-3.5 w-3.5 mr-1" /> Configurar
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Group editor dialog */}
      <Dialog open={!!editingGroup} onOpenChange={(v) => !v && setEditingGroupId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="h-4 w-4" /> {editingGroup?.name}
            </DialogTitle>
          </DialogHeader>
          {editingGroup && (
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-xs font-semibold flex items-center gap-1">
                    <UserCheck className="h-3.5 w-3.5" /> Corretores
                  </Label>
                  <Badge variant="secondary" className="text-[10px]">{editingGroup.brokers.length} selecionados</Badge>
                </div>
                <ScrollArea className="h-72 rounded border border-border/60 p-2">
                  <div className="space-y-1">
                    {brokers.map((b) => {
                      const on = editingGroup.brokers.includes(b.id);
                      return (
                        <label key={b.id} className="flex items-center gap-2 text-sm px-2 py-1 rounded hover:bg-muted/50 cursor-pointer">
                          <Checkbox checked={on} onCheckedChange={(v) => toggleGroupBroker(editingGroup.id, b.id, !!v)} />
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
                  <Label className="text-xs font-semibold flex items-center gap-1">
                    <FileText className="h-3.5 w-3.5" /> Formulários Meta
                  </Label>
                  <Badge variant="secondary" className="text-[10px]">{editingGroup.forms.length} selecionados</Badge>
                </div>
                <ScrollArea className="h-72 rounded border border-border/60 p-2">
                  <div className="space-y-1">
                    {detectedForms.map((d) => {
                      const on = editingGroup.forms.some((f) => f.form_id === d.form_id);
                      return (
                        <label key={d.form_id} className="flex items-center gap-2 text-sm px-2 py-1 rounded hover:bg-muted/50 cursor-pointer">
                          <Checkbox
                            checked={on}
                            onCheckedChange={(v) => {
                              if (v) addGroupForm(editingGroup.id, d.form_id, d.form_name);
                              else removeGroupForm(editingGroup.id, d.form_id);
                            }}
                          />
                          <span className="truncate flex-1">{d.form_name || d.form_id}</span>
                          {!d.form_name && <span className="text-[10px] text-muted-foreground truncate">{d.form_id}</span>}
                        </label>
                      );
                    })}
                    {detectedForms.length === 0 && (
                      <p className="text-xs text-muted-foreground p-2">Nenhum formulário detectado ainda. Use "Manual" abaixo.</p>
                    )}
                  </div>
                </ScrollArea>
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-full mt-2 h-7 text-[11px]"
                  onClick={() => {
                    const form_id = prompt("ID do formulário Meta (form_id):");
                    if (!form_id) return;
                    const form_name = prompt("Nome do formulário (opcional):", "") || null;
                    addGroupForm(editingGroup.id, form_id, form_name);
                  }}
                >
                  <Plus className="h-3 w-3 mr-1" /> Adicionar form manual
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingGroupId(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* Distribution windows (shifts) */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4" /> Janelas de Atendimento (turnos)</CardTitle>
          <Button size="sm" onClick={addWindow}><Plus className="h-4 w-4 mr-1" /> Adicionar</Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {windows.length === 0 && <p className="text-sm text-muted-foreground">Nenhum grupo configurado.</p>}
          {windows.map((w, idx) => (
            <div key={w.id || `new-${idx}`} className="grid md:grid-cols-[1fr_1fr_auto_auto_auto_auto_auto] gap-2 items-end p-3 rounded-lg border border-border/60">
              <div className="space-y-1">
                <Label className="text-xs">Slot (id interno)</Label>
                <Input value={w.slot} onChange={e => setWindows(ws => ws.map((x, i) => i === idx ? { ...x, slot: e.target.value } : x))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Nome</Label>
                <Input value={w.label} onChange={e => setWindows(ws => ws.map((x, i) => i === idx ? { ...x, label: e.target.value } : x))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Check-in</Label>
                <Input type="time" value={w.checkin_start.slice(0,5)} onChange={e => setWindows(ws => ws.map((x, i) => i === idx ? { ...x, checkin_start: e.target.value + ":00" } : x))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Início distrib.</Label>
                <Input type="time" value={w.distribution_start.slice(0,5)} onChange={e => setWindows(ws => ws.map((x, i) => i === idx ? { ...x, distribution_start: e.target.value + ":00" } : x))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Checkout</Label>
                <Input type="time" value={w.checkout_time.slice(0,5)} onChange={e => setWindows(ws => ws.map((x, i) => i === idx ? { ...x, checkout_time: e.target.value + ":00" } : x))} />
              </div>
              <div className="flex flex-col items-center gap-1">
                <Label className="text-xs">Ativo</Label>
                <Switch checked={w.active} onCheckedChange={v => setWindows(ws => ws.map((x, i) => i === idx ? { ...x, active: v } : x))} />
              </div>
              <div className="flex gap-1">
                <Button size="sm" onClick={() => upsertWindow(w)}><Save className="h-4 w-4" /></Button>
                {w.id && <Button size="sm" variant="destructive" onClick={() => deleteWindow(w.id!)}><Trash2 className="h-4 w-4" /></Button>}
              </div>
              {w.id && <Badge variant="outline" className="text-[10px] md:col-span-7 w-fit">id: {w.id}</Badge>}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
