import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { mockDevelopers, mockProjects, mockSources } from "@/data/mockData";
import { Plus, X, Copy, ExternalLink, Wifi } from "lucide-react";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface DataListProps {
  title: string;
  table: 'deals' | 'leads';
  column: string;
  items: string[];
  onUpdate: () => void;
}

function DataList({ title, table, column, items, onUpdate }: DataListProps) {
  const [newItem, setNewItem] = useState("");

  const addItem = async () => {
    if (!newItem.trim()) return;
    toast({ title: "Funcionalidade limitada", description: "A adição manual via Gestão de Dados requer novos registros vinculados." });
    setNewItem("");
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input 
          placeholder={`Novo ${title.toLowerCase()}... (Apenas leitura dos dados existentes)`} 
          value={newItem} 
          onChange={e => setNewItem(e.target.value)} 
          disabled
        />
        <Button size="sm" disabled><Plus className="h-4 w-4" /></Button>
      </div>
      <div className="space-y-1">
        {items.map((item, i) => (
          <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors">
            <span className="text-sm">{item}</span>
          </div>
        ))}
        {items.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">Nenhum dado encontrado no banco.</p>
        )}
      </div>
    </div>
  );
}

export default function DataManagement() {
  const [developers, setDevelopers] = useState<string[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const { data: deals } = await supabase.from('deals').select('developer, project');
      const { data: leads } = await supabase.from('leads').select('source');

      const devs = Array.from(new Set((deals || []).map(d => d.developer).filter(Boolean))) as string[];
      const projs = Array.from(new Set((deals || []).map(d => d.project).filter(Boolean))) as string[];
      const srcs = Array.from(new Set((leads || []).map(l => l.source).filter(Boolean))) as string[];

      setDevelopers(devs.sort());
      setProjects(projs.sort());
      setSources(srcs.sort());
    } catch (err) {
      console.error("Error fetching data management:", err);
    } finally {
      setLoading(false);
    }
  }
  const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/meta-ads-webhook`;

  // IP Management
  const [allowedIPs, setAllowedIPs] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("allowed_ips");
      return stored ? JSON.parse(stored) : ["", "", "", "", ""];
    } catch { return ["", "", "", "", ""]; }
  });

  const updateIP = (index: number, value: string) => {
    setAllowedIPs(prev => {
      const updated = [...prev];
      updated[index] = value;
      return updated;
    });
  };

  const saveIPs = () => {
    localStorage.setItem("allowed_ips", JSON.stringify(allowedIPs));
    toast({ title: "✅ IPs salvos!", description: "Os IPs permitidos para check-in foram atualizados." });
  };

  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    toast({ title: "URL copiada!", description: "Cole esta URL na configuração do Meta Ads." });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Gestão de Dados</h1>
        <p className="text-muted-foreground">Gerencie os dados cadastrais do sistema</p>
      </div>

      <Tabs defaultValue="developers">
        <TabsList className="glass">
          <TabsTrigger value="developers">Incorporadoras</TabsTrigger>
          <TabsTrigger value="projects">Empreendimentos</TabsTrigger>
          <TabsTrigger value="sources">Fontes</TabsTrigger>
          <TabsTrigger value="ips">IPs Check-in</TabsTrigger>
          <TabsTrigger value="integrations">Integrações</TabsTrigger>
        </TabsList>

        <TabsContent value="developers" className="mt-4">
          <Card className="glass"><CardContent className="p-4"><DataList title="Incorporadora" table="deals" column="developer" items={developers} onUpdate={fetchData} /></CardContent></Card>
        </TabsContent>
        <TabsContent value="projects" className="mt-4">
          <Card className="glass"><CardContent className="p-4"><DataList title="Empreendimento" table="deals" column="project" items={projects} onUpdate={fetchData} /></CardContent></Card>
        </TabsContent>
        <TabsContent value="sources" className="mt-4">
          <Card className="glass"><CardContent className="p-4"><DataList title="Fonte" table="leads" column="source" items={sources} onUpdate={fetchData} /></CardContent></Card>
        </TabsContent>

        {/* IP Configuration */}
        <TabsContent value="ips" className="mt-4">
          <Card className="glass">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Wifi className="h-5 w-5 text-primary" /> IPs Permitidos para Check-in
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Insira até 5 endereços IP autorizados para o check-in na fila de atendimento.
                Se nenhum IP for preenchido, o check-in será liberado de qualquer local.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {allowedIPs.map((ip, i) => (
                  <div key={i}>
                    <label className="text-xs text-muted-foreground mb-1 block">IP {i + 1}</label>
                    <Input
                      value={ip}
                      onChange={(e) => updateIP(i, e.target.value)}
                      placeholder={`Ex: 192.168.1.${i + 1}`}
                      className="font-mono text-sm"
                    />
                  </div>
                ))}
              </div>
              <Button size="sm" onClick={saveIPs}>Salvar IPs</Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Integrations - keep existing */}
        <TabsContent value="integrations" className="mt-4">
          <Card className="glass">
            <CardHeader>
              <CardTitle className="text-lg">Meta Ads — Webhook de Leads</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Configure o webhook abaixo no <strong>Meta Business Suite</strong> para receber leads automaticamente no pipeline. 
                Cada novo lead gera uma notificação em tempo real.
              </p>
              <div className="space-y-2">
                <label className="text-sm font-medium">URL do Webhook</label>
                <div className="flex gap-2">
                  <Input readOnly value={webhookUrl} className="font-mono text-xs" />
                  <Button size="sm" variant="outline" onClick={copyWebhookUrl}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Token de Verificação</label>
                <Input readOnly value="faceimob_meta_verify" className="font-mono text-xs" />
              </div>
              <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                <p className="text-xs text-muted-foreground">
                  <strong>Como configurar:</strong><br />
                  1. Acesse o <strong>Meta Business Suite → Leads Center → Configurações</strong><br />
                  2. Em "CRM" selecione "Integração de webhook"<br />
                  3. Cole a URL acima e o token de verificação<br />
                  4. Selecione os formulários que deseja integrar<br />
                  5. Cada lead preenchido no Meta Ads será criado automaticamente no Pipeline
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" asChild>
                  <a href="https://business.facebook.com/" target="_blank" rel="noreferrer">
                    <ExternalLink className="h-4 w-4 mr-1" /> Abrir Meta Business
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
