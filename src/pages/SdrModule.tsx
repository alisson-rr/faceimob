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
import { ImportError, parseSheet, rowsToRecords } from "@/components/leads/importSheet";
import { functionErrorMessage } from "@/lib/functionError";
import { describeError } from "@/lib/supabaseError";
import type { Database } from "@/integrations/supabase/types";

/**
 * Radix recusa `<SelectItem value="">` — string vazia é o valor que limpa a
 * seleção, então usar isso numa opção derruba a tela inteira. Sentinela para as
 * opções que significam "nenhum"; vira `null`/`""` na hora de gravar.
 */
const SEM_SELECAO = "__nenhum__";

type Agent = Database["public"]["Tables"]["sdr_agents"]["Row"];
type Conversation = Database["public"]["Tables"]["sdr_conversations"]["Row"];
type Message = Database["public"]["Tables"]["sdr_messages"]["Row"];
type Source = { id: string; label: string; form_id: string | null; source_match: string | null; agent_id: string | null; welcome_template_id: string | null; active: boolean };
type WhatsAppTemplate = Database["public"]["Tables"]["whatsapp_templates"]["Row"];
type ListStats = { total: number; pending: number; sent: number; replied: number; failed: number };
type Rlist = { id: string; name: string; description: string | null; template_name: string | null; template_language: string; stats: ListStats; status: string; agent_id: string | null };

export default function SdrModule() {
  const [tab, setTab] = useState("agents");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [lists, setLists] = useState<Rlist[]>([]);
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [waConfig, setWaConfig] = useState<Partial<WhatsAppTemplate>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  async function loadAll() {
    const [a, s, l, w] = await Promise.all([
      supabase.from("sdr_agents").select("*").order("created_at"),
      supabase.from("lead_sources").select("*").order("created_at"),
      supabase.from("remarketing_lists").select("*").order("created_at", { ascending: false }),
      supabase.from("whatsapp_templates").select("*").order("created_at"),
    ]);
    // Sem checar error, falha de RLS/rede virava empty state falso
    // ("Nenhum agente..."). Erro aparece e a tela oferece retry.
    const firstError = a.error || s.error || l.error || w.error;
    if (firstError) {
      setLoadError(describeError(firstError, "verifique sua permissão e tente de novo"));
      toast.error("Falha ao carregar os dados do SDR.");
      return;
    }
    setLoadError(null);
    setAgents(a.data || []);
    setSources((s.data || []).map(row => ({
      ...row,
      source_match: row.code,
      agent_id: row.sdr_agent_id,
    })));
    const templates = w.data || [];
    setTemplates(templates);
    // `remarketing_list_stats` agrega no banco. A versão anterior baixava a
    // tabela inteira de contatos para contar no navegador — cresce com a base e
    // ainda assim só dava o total, sem enviados/respondidos.
    const rows = l.data || [];
    let statsFailed = false;
    const withStats = await Promise.all(rows.map(async row => {
      const { data: stats, error: statsError } = await supabase.rpc("remarketing_list_stats", { p_list_id: row.id });
      if (statsError) statsFailed = true;
      const s0 = (stats as ListStats[] | null)?.[0];
      return {
        ...row,
        template_name: templates.find(template => template.id === row.template_id)?.name || null,
        template_language: templates.find(template => template.id === row.template_id)?.language || "pt_BR",
        stats: s0 ?? { total: 0, pending: 0, sent: 0, replied: 0, failed: 0 },
      };
    }));
    setLists(withStats);
    if (statsFailed) toast.error("Falha ao carregar estatísticas de uma ou mais listas de remarketing");
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

      {loadError && (
        <Card className="p-4 border-destructive/40 flex items-center justify-between gap-2 text-sm">
          <span>Não foi possível carregar os dados do SDR: {loadError}</span>
          <Button size="sm" variant="outline" onClick={loadAll}>Tentar novamente</Button>
        </Card>
      )}

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
        <TabsContent value="sources"><SourcesTab sources={sources} agents={agents} templates={templates} reload={loadAll} /></TabsContent>
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
    const payload: Database["public"]["Tables"]["sdr_agents"]["Insert"] = {
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
    if (error) return toast.error(describeError(error, "Não foi possível salvar o agente."));
    toast.success("Agente salvo");
    setEditing(null); reload();
  }
  async function remove(id: string) {
    if (!confirm("Excluir agente?")) return;
    const { error } = await supabase.from("sdr_agents").delete().eq("id", id);
    if (error) return toast.error(describeError(error, "Não foi possível excluir o agente."));
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
                <Bot className={`h-4 w-4 ${a.is_orchestrator ? "text-warning" : "text-primary"}`} />
                <div>
                  <div className="text-sm font-medium">{a.name}</div>
                  <div className="text-xs text-muted-foreground">{a.role} · {a.model}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {a.is_orchestrator && <Badge variant="secondary">Orquestrador</Badge>}
                {!a.active && <Badge variant="outline">Inativo</Badge>}
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
              <Select value={editing.handoff_to_agent_id || SEM_SELECAO} onValueChange={v => setEditing({ ...editing, handoff_to_agent_id: v === SEM_SELECAO ? null : v })}>
                <SelectTrigger><SelectValue placeholder="Nenhum" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM_SELECAO}>Nenhum</SelectItem>
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
function SourcesTab({ sources, agents, templates, reload }: { sources: Source[]; agents: Agent[]; templates: WhatsAppTemplate[]; reload: () => void }) {
  const [row, setRow] = useState<Partial<Source>>({ label: "", active: true });
  async function add() {
    if (!row.label) return toast.error("Label obrigatório");
    const code = (row.source_match || row.label).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    const { error } = await supabase.from("lead_sources").insert({
      code, label: row.label, form_id: row.form_id || null,
      sdr_agent_id: row.agent_id || null,
      welcome_template_id: row.welcome_template_id || null,
      active: row.active ?? true,
    });
    if (error) return toast.error(describeError(error, "Não foi possível cadastrar a origem."));
    setRow({ label: "", active: true }); reload();
  }
  async function remove(id: string) {
    const { error } = await supabase.from("lead_sources").delete().eq("id", id);
    if (error) return toast.error(describeError(error, "Não foi possível excluir a origem."));
    reload();
  }
  return (
    <Card className="p-4 space-y-3">
      <p className="text-xs text-muted-foreground">Configure quais formulários/origens de lead entram automaticamente no atendimento IA. Deixe em branco para configurar depois — o cadastro fica pronto.</p>
      <div className="grid md:grid-cols-6 gap-2">
        <Input placeholder="Rótulo" value={row.label || ""} onChange={e => setRow({ ...row, label: e.target.value })} />
        <Input placeholder="form_id (Meta Ads)" value={row.form_id || ""} onChange={e => setRow({ ...row, form_id: e.target.value })} />
        <Input placeholder="source contém..." value={row.source_match || ""} onChange={e => setRow({ ...row, source_match: e.target.value })} />
        <Select value={row.agent_id || SEM_SELECAO} onValueChange={v => setRow({ ...row, agent_id: v === SEM_SELECAO ? null : v })}>
          <SelectTrigger><SelectValue placeholder="Agente" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={SEM_SELECAO}>Sem agente</SelectItem>
            {agents.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={row.welcome_template_id || SEM_SELECAO} onValueChange={v => setRow({ ...row, welcome_template_id: v === SEM_SELECAO ? null : v })}>
          <SelectTrigger><SelectValue placeholder="Template de boas-vindas" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={SEM_SELECAO}>Sem template</SelectItem>
            {templates.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button onClick={add}><Plus className="h-4 w-4 mr-1" />Adicionar</Button>
      </div>
      <div className="space-y-1">
        {sources.map(s => (
          <div key={s.id} className="flex items-center justify-between border rounded p-2 text-sm">
            <div><b>{s.label}</b> <span className="text-muted-foreground text-xs">· {s.form_id || s.source_match || "sem filtro"} · {agents.find(a => a.id === s.agent_id)?.name || "sem agente"} · {templates.find(t => t.id === s.welcome_template_id)?.name || "sem template"}</span></div>
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
    } catch (e: unknown) {
      toast.error(await functionErrorMessage(e, "Falha no agente"));
    } finally { setLoading(false); }
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Select value={agentId || SEM_SELECAO} onValueChange={v => setAgentId(v === SEM_SELECAO ? "" : v)}>
          <SelectTrigger className="w-64"><SelectValue placeholder="Agente inicial (ou orquestrador automático)" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={SEM_SELECAO}>Automático (orquestrador)</SelectItem>
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
  const [rows, setRows] = useState<Conversation[]>([]);
  const [sel, setSel] = useState<string>("");
  const [msgs, setMsgs] = useState<Message[]>([]);

  async function load() {
    const { data } = await supabase.from("sdr_conversations").select("*").order("updated_at", { ascending: false }).limit(100);
    setRows(data || []);
  }
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!sel) { setMsgs([]); return; }
    supabase.from("sdr_messages").select("*").eq("conversation_id", sel).order("created_at").then(({ data }) => setMsgs(data || []));
  }, [sel]);

  return (
    <div className="grid md:grid-cols-[300px,1fr] gap-3">
      <Card className="p-2 max-h-[520px] overflow-y-auto">
        {rows.length === 0 && <p className="text-xs text-muted-foreground p-2">Sem conversas ainda.</p>}
        {rows.map(r => (
          <button key={r.id} onClick={() => setSel(r.id)} className={`w-full text-left p-2 rounded text-xs hover:bg-muted ${sel === r.id ? "bg-muted" : ""}`}>
            <div className="flex items-center justify-between">
              <b>{r.status}</b>
              <Badge variant="outline" size="sm">{r.score ?? "—"}</Badge>
            </div>
            <div className="text-muted-foreground">{agents.find(a => a.id === r.agent_id)?.name || "—"}</div>
            <div className="text-xs text-muted-foreground">{new Date(r.updated_at).toLocaleString("pt-BR")}</div>
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
      // Mesmo leitor da importação de leads: é dele que vêm os limites de
      // tamanho e de linhas, que este upload não tinha, e é ele que passou a
      // ser o único ponto do app que abre planilha de terceiro.
      const rows = rowsToRecords(await parseSheet(f));
      // Aceita colunas: nome/name, fone/telefone/phone, campanha/campaign
      const parsed = rows.map(keys => ({
        name: keys.nome || keys.name || keys.cliente || "",
        phone: keys.fone || keys.telefone || keys.phone || keys.celular || "",
        campaign: keys.campanha || keys.campaign || keys.origem || "",
        extra: keys,
      })).filter(r => r.phone);

      if (parsed.length === 0) return toast.error("Nenhum contato válido (verifique colunas nome/fone/campanha)");

      const { data: templateRow } = template
        ? await supabase.from("whatsapp_templates").select("id").eq("name", template).maybeSingle()
        : { data: null };
      const contacts = parsed.map(p => ({ full_name: p.name, phone: p.phone, extra: { campaign: p.campaign, ...p.extra } }));
      const { error: importError } = await supabase.rpc("import_remarketing_list", {
        p_name: newName,
        p_template_id: templateRow?.id || null,
        p_agent_id: agentId || null,
        p_contacts: contacts,
      });
      if (importError) throw importError;
      toast.success(`Lista "${newName}" criada com ${parsed.length} contatos`);
      setNewName(""); setTemplate(""); if (fileRef.current) fileRef.current.value = "";
      reload();
    } catch (err: unknown) {
      // A planilha recusada já explica o motivo em pt-BR; o resto é erro do
      // banco vindo da RPC de importação, e aí quem traduz é o describeError.
      toast.error(err instanceof ImportError ? err.message : describeError(err, "Falha ao importar a lista."));
    } finally { setUploading(false); }
  }

  async function broadcast(listId: string) {
    if (!confirm("Disparar template WhatsApp para todos os contatos pendentes desta lista?")) return;
    const { data, error } = await supabase.functions.invoke("sdr-whatsapp-broadcast", { body: { list_id: listId } });
    if (error) return toast.error(await functionErrorMessage(error, "Falha no disparo"));
    toast.success(`Enviados: ${data.sent} | Falhas: ${data.failed}`);
    reload();
  }

  async function removeList(id: string) {
    if (!confirm("Excluir lista?")) return;
    const { error } = await supabase.from("remarketing_lists").delete().eq("id", id);
    if (error) return toast.error(describeError(error, "Não foi possível excluir a lista."));
    reload();
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
                <div className="text-sm font-medium">{l.name} <Badge variant="outline" className="ml-2">{l.status}</Badge></div>
                <div className="text-xs text-muted-foreground">Template: {l.template_name || "—"} · {l.stats.total} contatos ({l.stats.pending} pendentes · {l.stats.sent} enviados · {l.stats.replied} respondidos{l.stats.failed > 0 ? ` · ${l.stats.failed} falhas` : ""}) · Agente: {agents.find(a => a.id === l.agent_id)?.name || "—"}</div>
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
function WhatsAppTab({ config, reload }: { config: Partial<WhatsAppTemplate>; reload: () => void }) {
  const [c, setC] = useState<Partial<WhatsAppTemplate>>(config);
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
      ? supabase.from("whatsapp_templates").update(payload).eq("id", c.id)
      : supabase.from("whatsapp_templates").insert(payload);
    const { data, error } = await query.select("id");
    if (error) return toast.error(describeError(error, "Não foi possível salvar o template."));
    if (!data?.length) return toast.error("A configuração não foi salva. Verifique sua permissão.");
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
