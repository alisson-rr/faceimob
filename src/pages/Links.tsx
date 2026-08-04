import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Link2, Plus, ExternalLink, Copy, Pencil, Trash2, Loader2, Save } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

type LinkRow = { id: string; title: string; url: string; category: string | null; sort_order: number };

export default function Links() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<Partial<LinkRow> | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("useful_links").select("*").eq("active", true).order("sort_order").order("label");
    if (error) toast({ title: "Erro ao carregar", description: error.message, variant: "destructive" });
    setLinks(((data as any[]) || []).map(row => ({ ...row, title: row.label })));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const copyLink = (url: string) => { navigator.clipboard.writeText(url); toast({ title: "Link copiado!" }); };

  const save = async () => {
    if (!edit?.title || !edit?.url) return toast({ title: "Preencha nome e URL", variant: "destructive" });
    setSaving(true);
    const payload = { label: edit.title, url: edit.url, category: edit.category || "geral", sort_order: edit.sort_order ?? 0, active: true };
    const { error } = edit.id
      ? await supabase.from("useful_links").update(payload).eq("id", edit.id)
      : await supabase.from("useful_links").insert(payload);
    setSaving(false);
    if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
    toast({ title: "Salvo!" });
    setEdit(null); load();
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir este link?")) return;
    const { error } = await supabase.from("useful_links").delete().eq("id", id);
    if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Links</h1>
          <p className="text-muted-foreground text-sm">Links úteis da operação</p>
        </div>
        {isAdmin && (
          <Button size="sm" onClick={() => setEdit({ title: "", url: "", category: "", sort_order: 0 })}>
            <Plus className="h-4 w-4 mr-2" /> Novo Link
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando...</div>
      ) : links.length === 0 ? (
        <Card className="glass"><CardContent className="p-8 text-center text-sm text-muted-foreground">Nenhum link cadastrado ainda.</CardContent></Card>
      ) : (
        <div className="grid gap-2">
          {links.map(l => (
            <Card key={l.id} className="glass hover:bg-secondary/50 transition-colors">
              <CardContent className="p-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-primary/20 flex items-center justify-center shrink-0"><Link2 className="h-4 w-4 text-primary" /></div>
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{l.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{l.category || "—"} · {l.url}</p>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => copyLink(l.url)}><Copy className="h-3.5 w-3.5" /></Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" asChild><a href={l.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5" /></a></Button>
                  {isAdmin && <>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEdit(l)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => remove(l.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{edit?.id ? "Editar Link" : "Novo Link"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nome</Label><Input value={edit?.title || ""} onChange={e => setEdit(p => ({ ...p, title: e.target.value }))} /></div>
            <div><Label>URL</Label><Input value={edit?.url || ""} onChange={e => setEdit(p => ({ ...p, url: e.target.value }))} placeholder="https://..." /></div>
            <div><Label>Categoria</Label><Input value={edit?.category || ""} onChange={e => setEdit(p => ({ ...p, category: e.target.value }))} placeholder="Ferramentas, Docs..." /></div>
            <div><Label>Ordem</Label><Input type="number" value={edit?.sort_order ?? 0} onChange={e => setEdit(p => ({ ...p, sort_order: Number(e.target.value) }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}><Save className="h-4 w-4 mr-2" />{saving ? "Salvando..." : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
