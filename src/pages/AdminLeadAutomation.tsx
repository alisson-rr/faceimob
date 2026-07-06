import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Plus, Trash2, Save, Zap, Timer, Users } from "lucide-react";

type Settings = {
  roleta_seconds: number;
  no_response_hours: number;
  inactivity_alert_hours: number;
  auto_first_contact: boolean;
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

export default function AdminLeadAutomation() {
  const [settings, setSettings] = useState<Settings>({
    roleta_seconds: 300,
    no_response_hours: 24,
    inactivity_alert_hours: 24,
    auto_first_contact: true,
    stage_max_minutes: { new: 5, first_contact: 60, no_response: 1440, warm: 2880, hot: 1440, gathering_docs: 4320 },
  });

  const [windows, setWindows] = useState<Window[]>([]);
  const [savingSettings, setSavingSettings] = useState(false);

  const load = async () => {
    const [{ data: s }, { data: w }] = await Promise.all([
      supabase.from("lead_automation_settings").select("*").eq("id", true).maybeSingle(),
      supabase.from("distribution_windows").select("*").order("distribution_start"),
    ]);
    if (s) setSettings(s as any);
    setWindows((w as any) || []);
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
    slot: "novo", label: "Novo grupo",
    checkin_start: "09:00", distribution_start: "09:30", checkout_time: "12:00",
    active: true,
  }]);

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Zap className="h-5 w-5" /> Automação de Leads</h1>
        <p className="text-sm text-muted-foreground">Configure roleta, grupos de distribuição e regras automáticas.</p>
      </div>

      {/* Automation rules */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Timer className="h-4 w-4" /> Regras & Tempos</CardTitle>
        </CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label>Tempo da roleta (segundos)</Label>
            <Input type="number" min={30} value={settings.roleta_seconds}
              onChange={e => setSettings(s => ({ ...s, roleta_seconds: +e.target.value }))} />
            <p className="text-[11px] text-muted-foreground">Tempo que um lead permanece em "Novo Lead" antes de expirar.</p>
          </div>
          <div className="space-y-1">
            <Label>Marcar "Sem Resposta" após (horas)</Label>
            <Input type="number" min={1} value={settings.no_response_hours}
              onChange={e => setSettings(s => ({ ...s, no_response_hours: +e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label>Alerta de inatividade (horas)</Label>
            <Input type="number" min={1} value={settings.inactivity_alert_hours}
              onChange={e => setSettings(s => ({ ...s, inactivity_alert_hours: +e.target.value }))} />
          </div>
          <div className="flex items-center gap-3 pt-6">
            <Switch checked={settings.auto_first_contact}
              onCheckedChange={v => setSettings(s => ({ ...s, auto_first_contact: v }))} />
            <div>
              <Label>Avanço automático para "Primeiro Contato"</Label>
              <p className="text-[11px] text-muted-foreground">Move o lead ao clicar WhatsApp / comentar / anexar.</p>
            </div>
          </div>
          <div className="md:col-span-2">
            <Button onClick={saveSettings} disabled={savingSettings}>
              <Save className="h-4 w-4 mr-2" /> {savingSettings ? "Salvando..." : "Salvar regras"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Stage max times (delay alerts) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Timer className="h-4 w-4" /> Tempo máximo por etapa (minutos)</CardTitle>
        </CardHeader>
        <CardContent className="grid md:grid-cols-3 gap-4">
          {STAGE_LABELS.map(st => (
            <div key={st.key} className="space-y-1">
              <Label className="text-xs">{st.label}</Label>
              <Input
                type="number" min={1}
                value={settings.stage_max_minutes?.[st.key] ?? 0}
                onChange={e => setSettings(s => ({
                  ...s,
                  stage_max_minutes: { ...(s.stage_max_minutes || {}), [st.key]: +e.target.value },
                }))}
              />
            </div>
          ))}
          <div className="md:col-span-3">
            <Button onClick={saveSettings} disabled={savingSettings}>
              <Save className="h-4 w-4 mr-2" /> Salvar tempos
            </Button>
            <p className="text-[11px] text-muted-foreground mt-1">Ao ultrapassar o tempo, um popup de atraso é disparado no funil.</p>
          </div>
        </CardContent>
      </Card>



      {/* Distribution windows */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4" /> Grupos de Distribuição</CardTitle>
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
