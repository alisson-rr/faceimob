import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Building2, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { slugify } from "@/lib/utils";
import { describeError } from "@/lib/supabaseError";

type DeveloperRow = {
  id: string;
  name: string;
  flow: "internal" | "external";
  submission_email: string | null;
  active: boolean;
};

/** RLS de update/delete não erra: só não casa linha. Sem linha = sem permissão. */
const NO_PERMISSION = "Sem permissão para alterar construtoras (apenas admin/CCA).";

function EmailCell({ dev, onSave }: { dev: DeveloperRow; onSave: (email: string) => Promise<void> }) {
  const [email, setEmail] = useState(dev.submission_email ?? "");
  const save = async () => {
    if ((dev.submission_email ?? "") === email.trim()) return;
    await onSave(email.trim());
  };
  return (
    <Input
      type="email"
      value={email}
      onChange={e => setEmail(e.target.value)}
      onBlur={save}
      onKeyDown={e => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      placeholder="email@construtora.com"
      className="h-7 text-xs"
      aria-label={`E-mail de envio de ${dev.name}`}
    />
  );
}

export default function AdminDevelopers() {
  const [developers, setDevelopers] = useState<DeveloperRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newDev, setNewDev] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("developers")
      .select("id,name,flow,submission_email,active")
      .order("name");
    if (error) {
      toast({ title: "Erro ao carregar construtoras", description: describeError(error, "Não foi possível carregar as construtoras."), variant: "destructive" });
    } else {
      setDevelopers((data ?? []) as DeveloperRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const update = async (id: string, patch: Partial<DeveloperRow>) => {
    const { data, error } = await supabase.from("developers").update(patch).eq("id", id).select("id");
    if (error) {
      toast({ title: "Erro ao atualizar", description: describeError(error, "Não foi possível atualizar a construtora."), variant: "destructive" });
      return false;
    }
    if (!data?.length) {
      toast({ title: NO_PERMISSION, variant: "destructive" });
      return false;
    }
    setDevelopers(prev => prev.map(d => (d.id === id ? { ...d, ...patch } : d)));
    return true;
  };

  const toggleCca = async (dev: DeveloperRow) => {
    const flow = dev.flow === "internal" ? "external" : "internal";
    if (flow === "external" && !dev.submission_email) {
      return toast({
        title: "Cadastre o e-mail de envio antes",
        description: "O fluxo externo envia os documentos por e-mail à construtora.",
        variant: "destructive",
      });
    }
    if (await update(dev.id, { flow })) toast({ title: "Configuração atualizada" });
  };

  const toggleActive = async (dev: DeveloperRow) => {
    if (await update(dev.id, { active: !dev.active })) toast({ title: "Configuração atualizada" });
  };

  const saveEmail = async (dev: DeveloperRow, email: string) => {
    // Constraint do banco: fluxo externo exige e-mail — o erro volta no toast.
    await update(dev.id, { submission_email: email || null });
  };

  const addDev = async () => {
    const name = newDev.trim();
    if (!name) return;
    setSaving(true);
    const { error } = await supabase.from("developers").insert({
      name,
      slug: slugify(name),
      submission_email: newEmail.trim() || null,
    });
    setSaving(false);
    if (error) {
      return toast({ title: "Erro ao adicionar construtora", description: describeError(error, "Não foi possível adicionar a construtora."), variant: "destructive" });
    }
    setNewDev("");
    setNewEmail("");
    toast({ title: "Construtora adicionada" });
    await load();
  };

  const removeDev = async (dev: DeveloperRow) => {
    const { data, error } = await supabase.from("developers").delete().eq("id", dev.id).select("id");
    if (error) {
      return toast({
        title: "Não foi possível remover",
        description: `${describeError(error, "Não foi possível remover a construtora.")} Se houver negócios vinculados, desative a construtora em vez de removê-la.`,
        variant: "destructive",
      });
    }
    if (!data?.length) return toast({ title: NO_PERMISSION, variant: "destructive" });
    setDevelopers(prev => prev.filter(d => d.id !== dev.id));
    toast({ title: "Construtora removida" });
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2"><Building2 className="h-5 w-5 text-primary" /> Construtoras & CCA</h1>
        <p className="text-xs text-muted-foreground">Configure quais construtoras utilizam o CCA interno para aprovação de crédito. No fluxo externo, os documentos vão por e-mail à construtora.</p>
      </div>

      <Card className="border-border/50">
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm">Adicionar Construtora</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <Input value={newDev} onChange={e => setNewDev(e.target.value)} placeholder="Nome da construtora" className="text-xs sm:max-w-64" />
            <Input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="E-mail de envio (fluxo externo)" className="text-xs sm:max-w-64" />
            <Button size="sm" onClick={addDev} disabled={saving}>
              {saving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Plus className="h-3 w-3 mr-1" />} Adicionar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Carregando construtoras…
            </div>
          ) : developers.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground">Nenhuma construtora cadastrada.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/40">
                  <th className="p-3 text-left font-medium text-muted-foreground">Construtora</th>
                  <th className="p-3 text-center font-medium text-muted-foreground">CCA Interno</th>
                  <th className="p-3 text-left font-medium text-muted-foreground">E-mail de envio</th>
                  <th className="p-3 text-center font-medium text-muted-foreground">Ativa</th>
                  <th className="p-3 text-right font-medium text-muted-foreground">Ações</th>
                </tr>
              </thead>
              <tbody>
                {developers.map(dev => (
                  <tr key={dev.id} className="border-b border-border/10 hover:bg-primary/5">
                    <td className="p-3 font-medium">
                      {dev.name}{" "}
                      <Badge variant="outline" className={dev.flow === "internal" ? "ml-1 text-warning border-warning/30" : "ml-1 text-muted-foreground"}>
                        {dev.flow === "internal" ? "CCA Ativo" : "Fluxo externo"}
                      </Badge>
                    </td>
                    <td className="p-3 text-center">
                      <Switch checked={dev.flow === "internal"} onCheckedChange={() => toggleCca(dev)} aria-label={`CCA interno de ${dev.name}`} />
                    </td>
                    <td className="p-3 min-w-56">
                      <EmailCell key={`${dev.id}-${dev.submission_email ?? ""}`} dev={dev} onSave={email => saveEmail(dev, email)} />
                    </td>
                    <td className="p-3 text-center">
                      <Switch checked={dev.active} onCheckedChange={() => toggleActive(dev)} aria-label={`Construtora ${dev.name} ativa`} />
                    </td>
                    <td className="p-3 text-right">
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-destructive" onClick={() => removeDev(dev)} aria-label={`Remover ${dev.name}`}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
