import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Save, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { describeError } from "@/lib/supabaseError";
import { useAuth } from "@/contexts/AuthContext";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="glass border-border/40 p-0 overflow-hidden">
      <div className="bg-secondary/50 px-4 py-2 text-sm font-semibold">{title}</div>
      <div className="p-4">{children}</div>
    </Card>
  );
}

function FileUpload({ onFile, hint, accept = ".csv,.xlsx,.xls" }: { onFile: (f: File) => void; hint?: string; accept?: string }) {
  const [drag, setDrag] = useState(false);
  const [name, setName] = useState<string | null>(null);
  return (
    <label
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => {
        e.preventDefault(); setDrag(false);
        const f = e.dataTransfer.files?.[0]; if (f) { setName(f.name); onFile(f); }
      }}
      className={`flex flex-col items-center justify-center gap-1 border-2 border-dashed rounded-lg px-4 py-6 text-center cursor-pointer transition ${drag ? "border-primary bg-primary/10" : "border-primary/40 bg-background hover:bg-secondary/30"}`}
    >
      <input type="file" className="hidden" accept={accept} onChange={e => { const f = e.target.files?.[0]; if (f) { setName(f.name); onFile(f); } }} />
      <p className="text-xs font-medium">{name ? `📄 ${name}` : (hint || "Clique ou arraste o arquivo aqui")}</p>
      <p className="text-xs text-muted-foreground">CSV, XLSX ou XLS</p>
    </label>
  );
}

type Developer = { id: string; name: string };
type Aporte = { id: string; period: string; amount: number; developer_id: string };

const monthStart = () => {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
};

export default function DataManagement() {
  const { role } = useAuth();
  const canEditAporte = role === "admin" || role === "marketing";

  // Aportes (Marketing)
  const [devs, setDevs] = useState<Developer[]>([]);
  const [aportes, setAportes] = useState<Aporte[]>([]);
  const [aporte, setAporte] = useState({ period: monthStart(), amount: "", developer_id: "" });
  const [monthTotal, setMonthTotal] = useState(0);
  const [savingAporte, setSavingAporte] = useState(false);

  const loadAportes = async () => {
    const { data } = await supabase.from("marketing_investments").select("*").gte("period", monthStart()).order("period", { ascending: false });
    const list = (data as Aporte[]) || [];
    setAportes(list);
    setMonthTotal(list.reduce((s, r) => s + Number(r.amount || 0), 0));
  };
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("developers").select("id,name").eq("active", true).order("name");
      setDevs((data as Developer[]) || []);
      loadAportes();
    })();
  }, []);

  const saveAporte = async () => {
    if (!aporte.amount || !aporte.period || !aporte.developer_id) return toast({ title: "Preencha mês, valor e construtora", variant: "destructive" });
    setSavingAporte(true);
    const { error } = await supabase.from("marketing_investments").insert({
      period: aporte.period.slice(0, 7) + "-01", amount: Number(aporte.amount), developer_id: aporte.developer_id,
    });
    setSavingAporte(false);
    if (error) return toast({ title: "Erro ao salvar", description: describeError(error, "Não foi possível salvar o aporte."), variant: "destructive" });
    toast({ title: "Aporte salvo" });
    setAporte({ period: monthStart(), amount: "", developer_id: "" });
    loadAportes();
  };

  const removeAporte = async (id: string) => {
    await supabase.from("marketing_investments").delete().eq("id", id);
    loadAportes();
  };

  const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold">Gestão de dados</h1>
      <Tabs defaultValue="leadfy" className="w-full">
        <TabsList className="bg-transparent border-b border-border/40 rounded-none w-full justify-start gap-4 h-auto p-0">
          {[["leadfy", "Leadfy"], ["marketing", "Marketing"]].map(([v, l]) => (
            <TabsTrigger key={v} value={v} className="bg-transparent rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent pb-2 font-semibold">
              {l}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* LEADFY */}
        <TabsContent value="leadfy" className="mt-6 grid md:grid-cols-2 gap-4">
          <SectionCard title="Upload Leadfy">
            <FileUpload onFile={(f) => toast({ title: `Arquivo ${f.name} carregado — vá para Leads para importar` })} hint="Solte o CSV/XLSX do Leadfy" />
            <p className="text-xs text-muted-foreground mt-3">Após carregar, abra <strong>Pipeline → Leads</strong> e clique em "Importar Leadfy" para processar os leads.</p>
          </SectionCard>
          <SectionCard title="Formato esperado">
            <div className="text-xs space-y-1 text-muted-foreground">
              <p>Colunas: <code className="text-foreground">Nome, Telefone, Email, Fonte, Empreendimento, Status, Observações</code></p>
              <p>Primeira linha deve ser o cabeçalho.</p>
            </div>
          </SectionCard>
        </TabsContent>

        {/* MARKETING */}
        <TabsContent value="marketing" className="mt-6 space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <SectionCard title="Upload Planilha Marketing">
              <FileUpload onFile={(f) => toast({ title: `Arquivo ${f.name} carregado` })} hint="Solte a planilha de campanhas" />
            </SectionCard>

            <SectionCard title={`Aporte de Mídia — ${MONTHS[new Date().getMonth()]}/${new Date().getFullYear()}`}>
              <div className="text-right text-sm mb-2">Total do mês: <strong className="text-success">{fmt(monthTotal)}</strong></div>
              {canEditAporte && (
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <Input type="month" value={aporte.period.slice(0, 7)} onChange={e => setAporte(p => ({ ...p, period: `${e.target.value}-01` }))} className="h-8 text-xs" />
                    <Input type="number" placeholder="Valor R$" value={aporte.amount} onChange={e => setAporte(p => ({ ...p, amount: e.target.value }))} className="h-8 text-xs" />
                    <Select value={aporte.developer_id} onValueChange={v => setAporte(p => ({ ...p, developer_id: v }))}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Construtora" /></SelectTrigger>
                      <SelectContent>{devs.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="flex justify-end">
                    <Button size="sm" onClick={saveAporte} disabled={savingAporte} className="gap-1"><Save className="h-3.5 w-3.5" />{savingAporte ? "..." : "Salvar Aporte"}</Button>
                  </div>
                </div>
              )}
            </SectionCard>
          </div>

          <Card className="glass border-border/40">
            <div className="bg-secondary/50 px-4 py-2 text-sm font-semibold">Aportes do mês</div>
            <div className="p-0 max-h-72 overflow-y-auto">
              {aportes.length === 0 ? (
                <p className="p-4 text-xs text-muted-foreground text-center">Nenhum aporte cadastrado neste mês.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Data</TableHead><TableHead>Construtora</TableHead><TableHead className="text-right">Valor</TableHead><TableHead></TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {aportes.map(a => (
                      <TableRow key={a.id}>
                        <TableCell className="text-xs">{a.period.slice(0, 7).split("-").reverse().join("/")}</TableCell>
                        <TableCell className="text-xs">{devs.find(d => d.id === a.developer_id)?.name || "—"}</TableCell>
                        <TableCell className="text-xs text-right text-success font-semibold">{fmt(Number(a.amount))}</TableCell>
                        <TableCell className="text-right">
                          {canEditAporte && <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeAporte(a.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
