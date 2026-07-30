import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Bot, Plus, Trash2, Upload, Send, MessageSquare, Sparkles, RefreshCw } from "lucide-react";
import * as XLSX from "xlsx";

type Agent = {
  id: string; name: string; role: string; is_orchestrator: boolean;
  system_prompt: string | null; model: string; temperature: number; active: boolean;
  handoff_to_agent_id: string | null;
};
type Source = { id: string; label: string; form_id: string | null; source_match: string | null; agent_id: string | null; active: boolean };
type Rlist = { id: string; name: string; description: string | null; template_name: string | null; template_language: string; total_contacts: number; status: string; agent_id: string | null };

export default function SdrModule() {
  const [tab, setTab] = useState("agents");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [lists, setLists] = useState<Rlist[]>([]);
  const [waConfig, setWaConfig] = useState<any>({});

  async function loadAll() {
    const [a, s, l, w, contacts] = await Promise.all([
      (supabase as any).from("sdr_agents").select("*").order("created_at"),
      (supabase as any).from("lead_sources").select("*").order("created_at"),
      (supabase as any).from("remarketing_lists").select("*").order("created_at", { ascending: false }),
      (supabase as any).from("whatsapp_templates").select("*").order("created_at"),
      (supabase as any).from("remarketing_contacts").select("list_id"),
    ]);
    setAgents((a.data as any) || []);
    setSources(((s.data as any[]) || []).map(row => ({
      ...row,
      source_match: row.code,
      agent_id: row.sdr_agent_id,
    })));
    const templates = (w.data as any[]) || [];
    setLists(((l.data as any[]) || []).map(row => ({
      ...row,
      template_name: templates.find(template => template.id === row.template_id)?.name || null,
      template_language: templates.find(template => template.id === row.template_id)?.language || "pt_BR",
      total_contacts: ((contacts.data as any[]) || []).filter(contact => contact.list_id === row.id).length,
    })));
    setWaConfig(templates[0] || { name: "", language: "pt_BR", body: "", approved: false, active: true });
  }
  useEffect(() => { loadAll(); }, []);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Bot className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-xl font-semibold">SDR IA da Face</h1>
          <p className="text-xs text-muted-foreground">Agentes de IA para qualificação de leads, orquestrador multi-agente e remarketing WhatsApp.</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="agents"><Bot className="h-4 w-4 mr-2" />Agentes</TabsTrigger>
          <TabsTrigger value="sources">Origens</TabsTrigger>
          <TabsTrigger value="playground"><Sparkles className="h-4 w-4 mr-2" />Playground</TabsTrigger>
          <TabsTrigger value="conversations"><MessageSquare className="h-4 w-4 mr-2" />Conversas</TabsTrigger>
          <TabsTrigger value="remarketing"><Send className="h-4 w-4 mr-2" />Remarketing</TabsTrigger>
          <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
        </TabsList>

        <TabsContent value="agents"><AgentsTab agents={agents} reload={loadAll} /></TabsContent>
        <TabsContent value="sources"><SourcesTab sources={sources} agents={agents} reload={loadAll} /></TabsContent>
        <TabsContent value="playground"><PlaygroundTab agents={agents} /></TabsContent>
        <TabsContent value="conversations"><ConversationsTab agents={agents} /></TabsContent>
        <TabsContent value="remarketing"><RemarketingTab lists={lists} agents={agents} reload={loadAll} /></TabsContent>
        <TabsContent value="whatsapp"><WhatsAppTab config={waConfig} reload={loadAll} /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ---------------- Agents ---------------- */
function AgentsTab({ agents, reload }: { agents: Agent[]; reload: () => void }) {
  const [editing, setEditing] = useState<Partial<Agent> | null>(null);

  async function save() {
    if (!editing?.name) return toast.error("Nome obrigatório");
    const payload: any = {
      name: editing.name, role: editing.role || "qualifier",
      is_orchestrator: !!editing.is_orchestrator,
      system_prompt: editing.system_prompt || null,
      model: editing.model || "gpt-4o-mini",
      temperature: Number(editing.temperature ?? 0.7),
      active: editing.active ?? true,
      handoff_to_agent_id: editing.handoff_to_agent_id || null,
    };
    const q = editing.id
      ? supabase.from("sdr_agents").update(payload).eq("id", editing.id)
      : supabase.from("sdr_agents").insert(payload);
    const { error } = await q;
    if (error) return toast.error(error.message);
    toast.success("Agente salvo");
    setEditing(null); reload();
  }
  async function remove(id: string) {
    if (!confirm("Excluir agente?")) return;
    const { error } = await supabase.from("sdr_agents").delete().eq("id", id);
    if (error) return toast.error(error.message);
    reload();
  }

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Agentes ({agents.length})</h3>
          <Button size="sm" onClick={() => setEditing({ name: "", role: "qualifier", model: "gpt-4o-mini", temperature: 0.7, active: true })}>
            <Plus className="h-4 w-4 mr-1" />Novo
          </Button>
        </div>
        <div className="space-y-2">
          {agents.length === 0 && <p className="text-xs text-muted-foreground">Nenhum agente. Crie um orquestrador e alguns especialistas (qualificador, reengajador, handoff).</p>}
          {agents.map(a => (
            <div key={a.id} className="flex items-center justify-between border rounded-md p-2 hover:bg-muted/40 cursor-pointer" onClick={() => setEditing(a)}>
              <div className="flex items-center gap-2">
                <Bot className={`h-4 w-4 ${a.is_orchestrator ? "text-amber-500" : "text-primary"}`} />
                <div>
                  <div className="text-sm font-medium">{a.name}</div>
                  <div className="text-[10px] text-muted-foreground">{a.role} · {a.model}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {a.is_orchestrator && <Badge variant="secondary" className="text-[10px]">Orquestrador</Badge>}
                {!a.active && <Badge variant="outline" className="text-[10px]">Inativo</Badge>}
                <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); remove(a.id); }}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        {!editing ? (
          <p className="text-xs text-muted-foreground">Selecione ou crie um agente.</p>
        ) : (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">{editing.id ? "Editar agente" : "Novo agente"}</h3>
            <div>
              <Label>Nome</Label>
              <Input value={editing.name || ""} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="Ex.: Orquestrador Face, Qualificador Frio, Reengajador..." />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Papel</Label>
                <Select value={editing.role || "qualifier"} onValueChange={v => setEditing({ ...editing, role: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="orchestrator">Orquestrador</SelectItem>
                    <SelectItem value="qualifier">Qualificador (Frio→Morno)</SelectItem>
                    <SelectItem value="reengager">Reengajador (Remarketing)</SelectItem>
                    <SelectItem value="handoff">Handoff / Entrega Corretor</SelectItem>
                    <SelectItem value="custom">Personalizado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Modelo OpenAI</Label>
                <Select value={editing.model || "gpt-4o-mini"} onValueChange={v => setEditing({ ...editing, model: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gpt-4o-mini">gpt-4o-mini (rápido/barato)</SelectItem>
                    <SelectItem value="gpt-4o">gpt-4o (potente)</SelectItem>
                    <SelectItem value="gpt-4.1-mini">gpt-4.1-mini</SelectItem>
                    <SelectItem value="gpt-4.1">gpt-4.1</SelectItem>
                    <SelectItem value="o4-mini">o4-mini (raciocínio)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Temperatura ({editing.temperature ?? 0.7})</Label>
                <Input type="number" step="0.1" min="0" max="2" value={editing.temperature ?? 0.7} onChange={e => setEditing({ ...editing, temperature: Number(e.target.value) })} />
              </div>
              <div className="flex items-center gap-3 pt-6">
                <div className="flex items-center gap-2">
                  <Switch checked={!!editing.is_orchestrator} onCheckedChange={v => setEditing({ ...editing, is_orchestrator: v })} />
                  <Label>Orquestrador</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={editing.active ?? true} onCheckedChange={v => setEditing({ ...editing, active: v })} />
                  <Label>Ativo</Label>
                </div>
              </div>
            </div>
            <div>
              <Label>System prompt (instruções do agente)</Label>
              <Textarea rows={8} value={editing.system_prompt || ""} onChange={e => setEditing({ ...editing, system_prompt: e.target.value })}
                placeholder="Ex.: Você é um SDR da Faceimob. Qualifique o lead perguntando: renda, urgência, tipo de imóvel, cidade e se possui FGTS. Nunca prometa aprovação. Quando o lead estiver quente, escreva: HANDOFF." />
            </div>
            <div>
              <Label>Handoff para agente</Label>
              <Select value={editing.handoff_to_agent_id || ""} onValueChange={v => setEditing({ ...editing, handoff_to_agent_id: v || null })}>
                <SelectTrigger><SelectValue placeholder="Nenhum" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Nenhum</SelectItem>
                  {agents.filter(a => a.id !== editing.id).map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button onClick={save}>Salvar</Button>
              <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ---------------- Sources ---------------- */
function SourcesTab({ sources, agents, reload }: { sources: Source[]; agents: Agent[]; reload: () => void }) {
  const [row, setRow] = useState<Partial<Source>>({ label: "", active: true });
  async function add() {
    if (!row.label) return toast.error("Label obrigatório");
    const code = (row.source_match || row.label).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    const { error } = await (supabase as any).from("lead_sources").insert({
      code, label: row.label, form_id: row.form_id || null,
      sdr_agent_id: row.agent_id || null, active: row.active ?? true,
    });
    if (error) return toast.error(error.message);
    setRow({ label: "", active: true }); reload();
  }
  async function remove(id: string) {
    await (supabase as any).from("lead_sources").delete().eq("id", id); reload();
  }
  return (
    <Card className="p-4 space-y-3">
      <p className="text-xs text-muted-foreground">Configure quais formulários/origens de lead entram automaticamente no atendimento IA. Deixe em branco para configurar depois — o cadastro fica pronto.</p>
      <div className="grid md:grid-cols-5 gap-2">
        <Input placeholder="Rótulo" value={row.label || ""} onChange={e => setRow({ ...row, label: e.target.value })} />
        <Input placeholder="form_id (Meta Ads)" value={row.form_id || ""} onChange={e => setRow({ ...row, form_id: e.target.value })} />
        <Input placeholder="source contém..." value={row.source_match || ""} onChange={e => setRow({ ...row, source_match: e.target.value })} />
        <Select value={row.agent_id || ""} onValueChange={v => setRow({ ...row, agent_id: v || null })}>
          <SelectTrigger><SelectValue placeholder="Agente" /></SelectTrigger>
          <SelectContent>
            {agents.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button onClick={add}><Plus className="h-4 w-4 mr-1" />Adicionar</Button>
      </div>
      <div className="space-y-1">
        {sources.map(s => (
          <div key={s.id} className="flex items-center justify-between border rounded p-2 text-sm">
            <div><b>{s.label}</b> <span className="text-muted-foreground text-xs">· {s.form_id || s.source_match || "sem filtro"} · {agents.find(a => a.id === s.agent_id)?.name || "sem agente"}</span></div>
            <Button size="icon" variant="ghost" onClick={() => remove(s.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ---------------- Playground ---------------- */
function PlaygroundTab({ agents }: { agents: Agent[] }) {
  const [agentId, setAgentId] = useState<string>("");
  const [convId, setConvId] = useState<string>("");
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function send() {
    if (!input.trim()) return;
    const text = input.trim();
    setMessages(m => [...m, { role: "user", content: text }]);
    setInput(""); setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("sdr-agent-chat", {
        body: { conversation_id: convId || undefined, agent_id: agentId || undefined, message: text, channel: "playground" },
      });
      if (error) throw error;
      if (!convId) setConvId(data.conversation_id);
      setMessages(m => [...m, { role: "assistant", content: data.reply }]);
      if (data.handoff_to) toast.info(`Orquestrador transferiu para: ${data.handoff_to.name}`);
    } catch (e: any) {
      toast.error(e.message || "Falha no agente");
    } finally { setLoading(false); }
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Select value={agentId} onValueChange={setAgentId}>
          <SelectTrigger className="w-64"><SelectValue placeholder="Agente inicial (ou orquestrador automático)" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="">Automático (orquestrador)</SelectItem>
            {agents.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => { setMessages([]); setConvId(""); }}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" />Nova conversa
        </Button>
      </div>
      <div className="h-[420px] overflow-y-auto border rounded-md p-3 space-y-2 bg-muted/20">
        {messages.length === 0 && <p className="text-xs text-muted-foreground text-center py-8">Simule uma conversa de lead. As mensagens ficam salvas em Conversas.</p>}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-card border"}`}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && <div className="text-xs text-muted-foreground">Agente pensando...</div>}
        <div ref={bottomRef} />
      </div>
      <div className="flex gap-2">
        <Input placeholder="Simule o lead escrevendo aqui..." value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} />
        <Button onClick={send} disabled={loading}><Send className="h-4 w-4" /></Button>
      </div>
    </Card>
  );
}

/* ---------------- Conversations ---------------- */
function ConversationsTab({ agents }: { agents: Agent[] }) {
  const [rows, setRows] = useState<any[]>([]);
  const [sel, setSel] = useState<string>("");
  const [msgs, setMsgs] = useState<any[]>([]);

  async function load() {
    const { data } = await supabase.from("sdr_conversations").select("*").order("updated_at", { ascending: false }).limit(100);
    setRows(data || []);
  }
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!sel) { setMsgs([]); return; }
    (supabase as any).from("sdr_messages").select("*").eq("conversation_id", sel).order("created_at").then(({ data }: any) => setMsgs(data || []));
  }, [sel]);

  return (
    <div className="grid md:grid-cols-[300px,1fr] gap-3">
      <Card className="p-2 max-h-[520px] overflow-y-auto">
        {rows.length === 0 && <p className="text-xs text-muted-foreground p-2">Sem conversas ainda.</p>}
        {rows.map(r => (
          <button key={r.id} onClick={() => setSel(r.id)} className={`w-full text-left p-2 rounded text-xs hover:bg-muted ${sel === r.id ? "bg-muted" : ""}`}>
            <div className="flex items-center justify-between">
              <b>{r.status}</b>
              <Badge variant="outline" className="text-[9px]">{r.score ?? "—"}</Badge>
            </div>
            <div className="text-muted-foreground">{agents.find(a => a.id === r.agent_id)?.name || "—"}</div>
            <div className="text-[10px] text-muted-foreground">{new Date(r.updated_at).toLocaleString("pt-BR")}</div>
          </button>
        ))}
      </Card>
      <Card className="p-3 max-h-[520px] overflow-y-auto space-y-2">
        {msgs.map(m => (
          <div key={m.id} className={`flex ${m.author === "lead" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${m.author === "lead" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
              {m.body}
            </div>
          </div>
        ))}
        {!sel && <p className="text-xs text-muted-foreground">Selecione uma conversa.</p>}
      </Card>
    </div>
  );
}

/* ---------------- Remarketing ---------------- */
function RemarketingTab({ lists, agents, reload }: { lists: Rlist[]; agents: Agent[]; reload: () => void }) {
  const [newName, setNewName] = useState("");
  const [template, setTemplate] = useState("");
  const [agentId, setAgentId] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!newName) return toast.error("Dê um nome para a lista antes");
    setUploading(true);
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" });
      // Aceita colunas: nome/name, fone/telefone/phone, campanha/campaign
      const parsed = rows.map(r => {
        const keys = Object.keys(r).reduce((acc: any, k) => { acc[k.toLowerCase().trim()] = r[k]; return acc; }, {});
        return {
          name: String(keys.nome || keys.name || keys.cliente || "").trim(),
          phone: String(keys.fone || keys.telefone || keys.phone || keys.celular || "").trim(),
          campaign: String(keys.campanha || keys.campaign || keys.origem || "").trim(),
          extra: keys,
        };
      }).filter(r => r.phone);

      if (parsed.length === 0) return toast.error("Nenhum contato válido (verifique colunas nome/fone/campanha)");

      const { data: templateRow } = template
        ? await (supabase as any).from("whatsapp_templates").select("id").eq("name", template).maybeSingle()
        : { data: null };
      const { data: list, error: lErr } = await (supabase as any).from("remarketing_lists").insert({
        name: newName, template_id: templateRow?.id || null, agent_id: agentId || null,
        status: "draft",
      }).select().single();
      if (lErr) throw lErr;

      const contacts = parsed.map(p => ({ full_name: p.name, phone: p.phone, extra: { campaign: p.campaign, ...p.extra }, list_id: list.id }));
      const chunkSize = 500;
      for (let i = 0; i < contacts.length; i += chunkSize) {
        const { error } = await (supabase as any).from("remarketing_contacts").insert(contacts.slice(i, i + chunkSize));
        if (error) throw error;
      }
      toast.success(`Lista "${newName}" criada com ${parsed.length} contatos`);
      setNewName(""); setTemplate(""); if (fileRef.current) fileRef.current.value = "";
      reload();
    } catch (err: any) {
      toast.error(err.message || "Falha no upload");
    } finally { setUploading(false); }
  }

  async function broadcast(listId: string) {
    if (!confirm("Disparar template WhatsApp para todos os contatos pendentes desta lista?")) return;
    const { data, error } = await supabase.functions.invoke("sdr-whatsapp-broadcast", { body: { list_id: listId } });
    if (error) return toast.error(error.message);
    toast.success(`Enviados: ${data.sent} | Falhas: ${data.failed}`);
    reload();
  }

  async function removeList(id: string) {
    if (!confirm("Excluir lista?")) return;
    await (supabase as any).from("remarketing_lists").delete().eq("id", id); reload();
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2"><Upload className="h-4 w-4" />Nova lista (Excel)</h3>
        <p className="text-xs text-muted-foreground">Suba um <b>.xlsx</b> com colunas: <b>nome, fone, campanha</b> (podem existir colunas extras que ficam salvas em contexto).</p>
        <div className="grid md:grid-cols-4 gap-2">
          <Input placeholder="Nome da lista" value={newName} onChange={e => setNewName(e.target.value)} />
          <Input placeholder="Nome do template Meta (aprovado)" value={template} onChange={e => setTemplate(e.target.value)} />
          <Select value={agentId} onValueChange={setAgentId}>
            <SelectTrigger><SelectValue placeholder="Agente que responde" /></SelectTrigger>
            <SelectContent>
              {agents.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} disabled={uploading} />
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-2">Listas ({lists.length})</h3>
        <div className="space-y-2">
          {lists.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma lista ainda.</p>}
          {lists.map(l => (
            <div key={l.id} className="flex items-center justify-between border rounded p-3">
              <div>
                <div className="text-sm font-medium">{l.name} <Badge variant="outline" className="ml-2 text-[10px]">{l.status}</Badge></div>
                <div className="text-[10px] text-muted-foreground">Template: {l.template_name || "—"} · {l.total_contacts} contatos · Agente: {agents.find(a => a.id === l.agent_id)?.name || "—"}</div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => broadcast(l.id)}><Send className="h-3.5 w-3.5 mr-1" />Disparar</Button>
                <Button size="icon" variant="ghost" onClick={() => removeList(l.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ---------------- WhatsApp Config ---------------- */
function WhatsAppTab({ config, reload }: { config: any; reload: () => void }) {
  const [c, setC] = useState<any>(config);
  useEffect(() => setC(config), [config]);
  async function save() {
    if (!c.name?.trim() || !c.body?.trim()) return toast.error("Informe nome e mensagem do template");
    const payload = {
      name: c.name.trim(),
      language: c.language || "pt_BR",
      category: c.category || "MARKETING",
      body: c.body,
      approved: !!c.approved,
      active: !!c.active,
    };
    const query = c.id
      ? (supabase as any).from("whatsapp_templates").update(payload).eq("id", c.id)
      : (supabase as any).from("whatsapp_templates").insert(payload);
    const { error } = await query;
    if (error) return toast.error(error.message);
    toast.success("Configuração salva"); reload();
  }
  return (
    <Card className="p-4 space-y-3 max-w-2xl">
      <p className="text-xs text-muted-foreground">Credenciais sensíveis ficam nos Secrets do backend. Aqui você cadastra o template aprovado pela Meta.</p>
      <div className="grid grid-cols-2 gap-2">
        <div><Label>Nome do template</Label><Input value={c.name || ""} onChange={e => setC({ ...c, name: e.target.value })} /></div>
        <div><Label>Idioma</Label><Input value={c.language || "pt_BR"} onChange={e => setC({ ...c, language: e.target.value })} /></div>
        <div className="col-span-2"><Label>Mensagem</Label><Textarea value={c.body || ""} onChange={e => setC({ ...c, body: e.target.value })} /></div>
        <div className="flex items-center gap-2">
          <Switch checked={!!c.approved} onCheckedChange={v => setC({ ...c, approved: v })} />
          <Label>Aprovado na Meta</Label>
        </div>
        <div className="col-span-2 flex items-center gap-2">
          <Switch checked={!!c.active} onCheckedChange={v => setC({ ...c, active: v })} />
          <Label>Módulo WhatsApp ativo</Label>
        </div>
      </div>
      <Button onClick={save}>Salvar</Button>
    </Card>
  );
}
