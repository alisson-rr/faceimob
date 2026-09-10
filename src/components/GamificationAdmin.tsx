import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Star, Megaphone, Save, Trash2, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { describeError } from "@/lib/supabaseError";

type Tip = { id: string; content: string; active: boolean };
type Notice = { id: string; title: string; message: string; pinned: boolean; active: boolean };

export function GamificationAdmin() {
  const [tips, setTips] = useState<Tip[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [tipDraft, setTipDraft] = useState("");
  const [noticeDraft, setNoticeDraft] = useState({ title: "", message: "", pinned: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const [t, n] = await Promise.all([
      supabase.from("gold_tips").select("*").order("created_at", { ascending: false }),
      supabase.from("important_notices").select("*").order("created_at", { ascending: false }),
    ]);
    setTips((t.data || []).map(row => ({ ...row, content: row.body })));
    setNotices((n.data || []).map(row => ({ ...row, message: row.body, pinned: row.severity === "critical" })));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const saveTip = async () => {
    if (!tipDraft.trim()) return;
    setSaving(true);
    await supabase.from("gold_tips").update({ active: false }).eq("active", true);
    const { error } = await supabase.from("gold_tips").insert({ title: "Dica de Ouro", body: tipDraft, active: true });
    setSaving(false);
    if (error) return toast({ title: "Falha ao publicar a dica", description: describeError(error, "Não foi possível publicar a dica de ouro."), variant: "destructive" });
    toast({ title: "Dica de ouro publicada" });
    setTipDraft(""); load();
  };

  const toggleTip = async (t: Tip) => {
    await supabase.from("gold_tips").update({ active: !t.active }).eq("id", t.id);
    load();
  };
  const removeTip = async (id: string) => { await supabase.from("gold_tips").delete().eq("id", id); load(); };

  const saveNotice = async () => {
    if (!noticeDraft.title.trim() || !noticeDraft.message.trim()) return toast({ title: "Preencha título e mensagem", variant: "destructive" });
    setSaving(true);
    const { error } = await supabase.from("important_notices").insert({
      title: noticeDraft.title,
      body: noticeDraft.message,
      severity: noticeDraft.pinned ? "critical" : "info",
      active: true,
    });
    setSaving(false);
    if (error) return toast({ title: "Falha ao publicar o recado", description: describeError(error, "Não foi possível publicar o recado."), variant: "destructive" });
    toast({ title: "Recado publicado" });
    setNoticeDraft({ title: "", message: "", pinned: false }); load();
  };
  const toggleNotice = async (n: Notice) => { await supabase.from("important_notices").update({ active: !n.active }).eq("id", n.id); load(); };
  const removeNotice = async (id: string) => { await supabase.from("important_notices").delete().eq("id", id); load(); };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="glass border-warning/30">
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Star className="h-4 w-4 text-warning" /> Dica de Ouro</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Textarea rows={3} placeholder="Ex.: 'Faça 3 ligações antes das 10h e sua conversão sobe 20%'" value={tipDraft} onChange={e => setTipDraft(e.target.value)} />
          <div className="flex justify-end"><Button size="sm" onClick={saveTip} disabled={saving} className="gap-1"><Save className="h-3.5 w-3.5" />Publicar dica</Button></div>

          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {tips.map(t => (
                <div key={t.id} className="flex items-start gap-2 p-2 rounded-lg border border-border/30 text-xs">
                  <p className="flex-1">{t.content}</p>
                  <Switch checked={t.active} onCheckedChange={() => toggleTip(t)} />
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeTip(t.id)}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                </div>
              ))}
              {tips.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma dica cadastrada.</p>}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="glass border-primary/30">
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Megaphone className="h-4 w-4 text-primary" /> Recado Importante</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div><Label className="text-xs">Título</Label><Input value={noticeDraft.title} onChange={e => setNoticeDraft(p => ({ ...p, title: e.target.value }))} /></div>
          <div><Label className="text-xs">Mensagem</Label><Textarea rows={3} value={noticeDraft.message} onChange={e => setNoticeDraft(p => ({ ...p, message: e.target.value }))} /></div>
          <div className="flex items-center gap-2"><Switch checked={noticeDraft.pinned} onCheckedChange={v => setNoticeDraft(p => ({ ...p, pinned: v }))} /><span className="text-xs">Fixar no topo</span></div>
          <div className="flex justify-end"><Button size="sm" onClick={saveNotice} disabled={saving} className="gap-1"><Save className="h-3.5 w-3.5" />Publicar recado</Button></div>

          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {notices.map(n => (
                <div key={n.id} className="flex items-start gap-2 p-2 rounded-lg border border-border/30 text-xs">
                  <div className="flex-1">
                    <p className="font-semibold">{n.pinned ? "📌 " : ""}{n.title}</p>
                    <p className="text-muted-foreground">{n.message}</p>
                  </div>
                  <Switch checked={n.active} onCheckedChange={() => toggleNotice(n)} />
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeNotice(n.id)}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                </div>
              ))}
              {notices.length === 0 && <p className="text-xs text-muted-foreground">Nenhum recado cadastrado.</p>}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function GamificationBanners() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);

  useEffect(() => {
    (async () => {
      const [t, n] = await Promise.all([
        supabase.from("gold_tips").select("*").eq("active", true).order("created_at", { ascending: false }).limit(1),
        supabase.from("important_notices").select("*").eq("active", true).order("created_at", { ascending: false }),
      ]);
      const tipRow = t.data?.[0];
      setTip(tipRow ? { ...tipRow, content: tipRow.body } : null);
      setNotices((n.data || []).map(row => ({ ...row, message: row.body, pinned: row.severity === "critical" })));
    })();
  }, []);

  if (!tip && notices.length === 0) return null;
  return (
    <div className="space-y-2">
      {tip && (
        <Card className="border-warning/50 bg-warning/10">
          <CardContent className="p-3 flex items-start gap-3">
            <Star className="h-5 w-5 text-warning shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-warning uppercase">Dica de Ouro</p>
              <p className="text-sm">{tip.content}</p>
            </div>
          </CardContent>
        </Card>
      )}
      {notices.map(n => (
        <Card key={n.id} className="border-primary/40 bg-primary/5">
          <CardContent className="p-3 flex items-start gap-3">
            <Megaphone className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs font-bold text-primary uppercase">{n.pinned ? "📌 Recado Fixado" : "Recado"}</p>
              <p className="text-sm font-semibold">{n.title}</p>
              <p className="text-xs text-muted-foreground">{n.message}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
