import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { KeyRound, RefreshCw, Send, Trash2 } from "lucide-react";
import { functionErrorMessage } from "@/lib/functionError";
import { describeError } from "@/lib/supabaseError";
import { SEM_PERMISSAO, SEM_SELECAO, type Agent } from "./types";

type Bubble = { role: "user" | "assistant" | "error"; content: string; agent?: string };

/** Mesmo teto do `sdr-agent-chat`: validar só no servidor deixava o operador
 *  escrever um texto longo para descobrir depois que ele não cabia. */
const MAX_CHARS = 4000;

export function PlaygroundTab({ agents, canWrite }: { agents: Agent[]; canWrite: boolean }) {
  const [agentId, setAgentId] = useState<string>("");
  const [convId, setConvId] = useState<string>("");
  const [messages, setMessages] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [testando, setTestando] = useState(false);
  const [descartando, setDescartando] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // Agente inativo não roda: `runSdrAgentTurn` recusa o id explícito que não
  // esteja ativo, então o switch "Ativo" da aba Agentes vale também aqui.
  const ativos = agents.filter(a => a.active);

  async function send() {
    if (!input.trim() || loading) return;
    const text = input.trim();
    if (text.length > MAX_CHARS) return toast.error(`Mensagem longa demais (máx. ${MAX_CHARS} caracteres).`);
    setMessages(m => [...m, { role: "user", content: text }]);
    setInput(""); setLoading(true);
    try {
      // Sem conversa nem lead a function pendura a simulação num lead de teste
      // do Playground, um por usuário (ver sdr-agent-chat/index.ts).
      // O agente escolhido só vale na abertura: em runSdrAgentTurn o `agent_id`
      // explícito ganha de `conv.agent_id`, e mandá-lo em toda mensagem
      // congelaria a conversa no agente inicial mesmo depois do handoff.
      const { data, error } = await supabase.functions.invoke("sdr-agent-chat", {
        body: { conversation_id: convId || undefined, agent_id: convId ? undefined : (agentId || undefined), message: text, channel: "playground" },
      });
      if (error) throw error;
      if (!convId) setConvId(data.conversation_id);
      setMessages(m => [...m, { role: "assistant", content: data.reply, agent: data.agent?.name }]);
      if (data.handoff_to) toast.info(`Conversa transferida para: ${data.handoff_to.name}`);
      if (data.exhausted) toast.warning("Teto de respostas do agente atingido — numa conversa real o lead voltaria para a roleta.");
    } catch (e: unknown) {
      // O erro fica no painel, não só num toast que some: sem a chave da OpenAI
      // no cofre a function responde 503 dizendo onde cadastrar.
      const msg = await functionErrorMessage(e, "Falha no agente");
      setMessages(m => [...m, { role: "error", content: msg }]);
      toast.error(msg);
    } finally { setLoading(false); }
  }

  /**
   * Descarta a simulação aberta. Toda mensagem do Playground fica gravada em
   * `sdr_conversations`/`sdr_messages` e aparecia na aba Conversas misturada
   * com atendimento de cliente real, sem como limpar. As mensagens saem por
   * cascata (`sdr_messages_conversation_id_fkey`); o lead de teste continua,
   * porque é ele que segura as próximas simulações deste usuário.
   */
  async function descartar() {
    if (!convId || descartando) return;
    setDescartando(true);
    const { data, error } = await supabase.from("sdr_conversations").delete().eq("id", convId).select("id");
    setDescartando(false);
    if (error) return toast.error(describeError(error, "Não foi possível descartar a simulação."));
    if (!data?.length) return toast.error(SEM_PERMISSAO);
    setMessages([]); setConvId("");
    toast.success("Simulação descartada — ela sai também da aba Conversas.");
  }

  /** Confere a chave do cofre sem gastar um turno de conversa. */
  async function testarChave() {
    setTestando(true);
    try {
      const { data, error } = await supabase.functions.invoke("sdr-agent-chat", { body: { action: "probe" } });
      if (error) throw error;
      toast.success(`Chave da OpenAI aceita (${data.models} modelos disponíveis).`);
    } catch (e: unknown) {
      const msg = await functionErrorMessage(e, "Não foi possível testar a chave da OpenAI");
      setMessages(m => [...m, { role: "error", content: msg }]);
      toast.error(msg);
    } finally { setTestando(false); }
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={agentId || SEM_SELECAO} onValueChange={v => setAgentId(v === SEM_SELECAO ? "" : v)}>
          <SelectTrigger className="w-64" aria-label="Agente inicial"><SelectValue placeholder="Agente inicial (ou orquestrador automático)" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={SEM_SELECAO}>Automático (orquestrador)</SelectItem>
            {ativos.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => { setMessages([]); setConvId(""); }}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" />Nova conversa
        </Button>
        {canWrite && convId && (
          <Button variant="outline" size="sm" className="text-destructive" disabled={descartando} onClick={descartar}>
            <Trash2 className="h-3.5 w-3.5 mr-1" />{descartando ? "Descartando…" : "Descartar simulação"}
          </Button>
        )}
        {canWrite && (
          <Button variant="outline" size="sm" disabled={testando} onClick={testarChave}>
            <KeyRound className="h-3.5 w-3.5 mr-1" />{testando ? "Testando…" : "Testar chave da OpenAI"}
          </Button>
        )}
      </div>
      <div className="h-[420px] overflow-y-auto border rounded-md p-3 space-y-2 bg-muted/20" aria-live="polite">
        {messages.length === 0 && <p className="text-xs text-muted-foreground text-center py-8">Simule uma conversa de lead. As mensagens ficam salvas em Conversas, num lead de teste do Playground — um por usuário, fora da roleta.</p>}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div data-bubble={m.role} className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
              m.role === "user" ? "bg-primary text-primary-foreground"
                : m.role === "error" ? "border border-destructive/40 bg-destructive/10 text-destructive"
                : "bg-card border"
            }`}>
              {m.agent && <div className="text-xs text-muted-foreground mb-1">{m.agent}</div>}
              {m.content}
            </div>
          </div>
        ))}
        {loading && <div className="text-xs text-muted-foreground">Agente pensando...</div>}
        <div ref={bottomRef} />
      </div>
      {canWrite ? (
        <>
          <div className="flex gap-2">
            <Input placeholder="Simule o lead escrevendo aqui..." aria-label="Mensagem do lead" maxLength={MAX_CHARS} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} />
            <Button onClick={send} disabled={loading} aria-label="Enviar"><Send className="h-4 w-4" /></Button>
          </div>
          {input.length > MAX_CHARS - 500 && (
            <p className="text-xs text-muted-foreground">{input.length} de {MAX_CHARS} caracteres.</p>
          )}
        </>
      ) : (
        // A simulação GRAVA conversa e gasta crédito da OpenAI: a function exige
        // o mesmo papel que a RLS exige para escrever em `sdr_conversations`.
        // Deixar o campo aqui daria um 403 depois de digitar.
        <p role="status" className="text-xs text-muted-foreground">
          A simulação grava a conversa no banco e consome a chave da OpenAI, então é de admin, marketing e SDR. Seu
          papel consulta o módulo: as conversas reais ficam na aba Conversas.
        </p>
      )}
    </Card>
  );
}
