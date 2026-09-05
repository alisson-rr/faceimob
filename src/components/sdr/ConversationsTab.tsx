import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoadingState } from "@/components/shared";
import { toast } from "sonner";
import { Hand, Bot as BotIcon, Send } from "lucide-react";
import { describeError } from "@/lib/supabaseError";
import { functionErrorMessage } from "@/lib/functionError";
import { dateTime } from "@/lib/format";
import {
  cadeiaDeAgentes, conversaParada, SEM_PERMISSAO, STATUS_CONVERSA,
  type Agent, type Conversation, type Message,
} from "./types";

/** O lead vem embutido; `null` quando a RLS do papel não alcança aquele lead.
 *  `utm_source` separa a simulação do Playground (`sdr_playground`) da conversa
 *  de cliente de verdade — as duas moravam misturadas nesta lista. */
type Row = Conversation & {
  leads: { full_name: string; phone: string | null; phone_raw: string | null; utm_source: string | null } | null;
};

const TODOS = "__todos__";
/** Quantas conversas por página. O corte existe porque a lista é uma coluna só;
 *  antes era um teto duro de 100 com um aviso e nenhuma saída. */
const PAGINA = 100;
/** Marca do lead de teste criado pelo `sdr-agent-chat` (PLAYGROUND_SOURCE). */
const ORIGEM_PLAYGROUND = "sdr_playground";
/** Mesmo teto do `humanReply` na edge function. */
const MAX_RESPOSTA = 4000;

/** Papéis que a policy `sdr_conversations_select` deixa ver TODAS as conversas.
 *  Os demais (manager, partner) só veem as de leads da própria visibilidade —
 *  lista curta ou vazia é o esperado, não falha. */
const VE_TUDO = ["admin", "director", "marketing", "sdr"];

export function ConversationsTab({ agents, canWrite }: { agents: Agent[]; canWrite: boolean }) {
  const { roles } = useAuth();
  const veTudo = roles.some((r) => VE_TUDO.includes(r));
  const [rows, setRows] = useState<Row[]>([]);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [temMais, setTemMais] = useState(false);
  const [buscandoMais, setBuscandoMais] = useState(false);
  const [sel, setSel] = useState<string>("");
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState<string>(TODOS);
  // `null` = carregando. Sem distinguir "sem mensagens" de "falhou ao carregar"
  // a conversa abandonada abria um painel em branco, igual a um erro de RLS.
  const [msgs, setMsgs] = useState<Message[] | null>([]);
  const [msgsError, setMsgsError] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [resposta, setResposta] = useState("");
  const [enviando, setEnviando] = useState(false);
  const fimDasMensagens = useRef<HTMLDivElement>(null);

  /** Quantas conversas a lista está mostrando agora. Ref e não estado porque
   *  `load()` roda DEPOIS de gravar (assumir, devolver, responder) e precisa
   *  reler a MESMA janela: relendo sempre a primeira página, quem tinha clicado
   *  em "Carregar mais" e selecionado uma conversa além da centésima via a
   *  seleção sumir no clique — com ela o cabeçalho, o botão "Devolver ao robô"
   *  e a caixa de resposta, enquanto as mensagens continuavam na tela. */
  const janela = useRef(PAGINA);

  const buscarPagina = useCallback(async (ate: number) => {
    // `range` em vez de `limit`: a lista precisava de uma saída para além das
    // 100 primeiras, e um aviso de "mostrando as 100 mais recentes" não é uma.
    // A ordem é por `last_message_at` — a mesma grandeza do selo "parada" e da
    // data exibida na linha. Por `updated_at`, assumir a conversa (que grava
    // `status`) empurrava para o topo justamente a que ninguém respondeu.
    // `nullsFirst: false` joga para o fim a conversa sem nenhuma mensagem: não
    // há o que o operador leia nela.
    const { data, error } = await supabase
      .from("sdr_conversations")
      .select("*, leads(full_name, phone, phone_raw, utm_source)")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .range(0, ate - 1);
    if (error) throw error;
    const lidas = (data ?? []) as Row[];
    janela.current = ate;
    setRows(lidas);
    // Página cheia = provavelmente há mais. Uma consulta a mais só para saber o
    // total seria cara e o número exato não muda nenhuma decisão da tela.
    setTemMais(lidas.length === ate);
  }, []);

  const load = useCallback(async () => {
    setCarregando(true);
    try {
      await buscarPagina(janela.current);
      setRowsError(null);
    } catch (e) {
      setRowsError(describeError(e, "Não foi possível carregar as conversas."));
    } finally {
      setCarregando(false);
    }
  }, [buscarPagina]);

  useEffect(() => { void load(); }, [load]);

  async function carregarMais() {
    setBuscandoMais(true);
    try {
      await buscarPagina(rows.length + PAGINA);
      setRowsError(null);
    } catch (e) {
      toast.error(describeError(e, "Não foi possível carregar mais conversas."));
    } finally {
      setBuscandoMais(false);
    }
  }

  // Qual conversa a última busca de mensagens pediu. Trocar de conversa antes
  // de a resposta chegar mostrava as mensagens da anterior no painel da nova.
  const conversaPedida = useRef<string>("");
  const carregarMensagens = useCallback(async (conversationId: string) => {
    conversaPedida.current = conversationId;
    setMsgs(null); setMsgsError(null);
    const { data, error } = await supabase
      .from("sdr_messages").select("*").eq("conversation_id", conversationId).order("created_at");
    if (conversaPedida.current !== conversationId) return;
    if (error) { setMsgsError(describeError(error, "Não foi possível carregar as mensagens.")); setMsgs([]); return; }
    setMsgs((data ?? []) as Message[]);
  }, []);

  useEffect(() => {
    if (!sel) { conversaPedida.current = ""; setMsgs([]); setMsgsError(null); return; }
    void carregarMensagens(sel);
  }, [sel, carregarMensagens]);

  useEffect(() => { fimDasMensagens.current?.scrollIntoView({ block: "nearest" }); }, [msgs]);

  const nomeDoLead = (r: Row) => r.leads?.full_name || "Lead fora da sua visibilidade";
  const telefone = (r: Row) => r.leads?.phone_raw || r.leads?.phone || "";
  const ehSimulacao = (r: Row) => r.leads?.utm_source === ORIGEM_PLAYGROUND;
  const nomeDoAgente = useCallback(
    (id: string) => agents.find((a) => a.id === id)?.name ?? "agente removido",
    [agents],
  );

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const digitos = termo.replace(/\D/g, "");
    return rows.filter((r) => {
      if (status !== TODOS && r.status !== status) return false;
      if (!termo) return true;
      const nome = (r.leads?.full_name || "").toLowerCase();
      const fone = telefone(r).replace(/\D/g, "");
      return nome.includes(termo) || (digitos.length >= 3 && fone.includes(digitos));
    });
  }, [rows, busca, status]);

  const atual = rows.find((r) => r.id === sel) ?? null;
  // A cadeia sai das MENSAGENS (`sdr_messages.agent_id`, migration 0082):
  // `sdr_conversations.agent_id` é sobrescrito a cada handoff e mostra só o
  // último agente — uma conversa que começou no orquestrador aparecia como se
  // sempre tivesse sido do qualificador.
  const cadeia = useMemo(() => cadeiaDeAgentes(msgs ?? [], nomeDoAgente), [msgs, nomeDoAgente]);

  /**
   * Assumir / devolver. O `whatsapp-inbound-webhook` só atende conversa
   * `active`: gravar 'human' é o que faz o robô parar de responder sem encerrar
   * o atendimento. O UPDATE condicional evita passar por cima de um desfecho
   * que chegou no meio (a conversa pode ter sido entregue à roleta).
   */
  async function trocarStatus(novo: "human" | "active") {
    if (!atual) return;
    const anterior = novo === "human" ? "active" : "human";
    setSalvando(true);
    const { data, error } = await supabase
      .from("sdr_conversations")
      .update({ status: novo })
      .eq("id", atual.id)
      .eq("status", anterior)
      .select("id");
    setSalvando(false);
    if (error) return toast.error(describeError(error, "Não foi possível mudar a conversa."));
    if (!data?.length) return toast.error(SEM_PERMISSAO);
    toast.success(novo === "human"
      ? "Você assumiu a conversa — o robô não responde mais nela."
      : "Conversa devolvida ao robô.");
    await load();
  }

  /**
   * Resposta do operador, enviada de dentro do CRM.
   *
   * A function grava a mensagem SÓ depois de a Meta aceitar, e devolve 503 com
   * `code: missing_credential` quando falta o token da Cloud API — por isso o
   * texto digitado só é limpo quando o envio de fato saiu. Antes desta caixa, a
   * tela mandava o operador "falar pelo aparelho": o CRM registrava a conversa
   * e não deixava continuá-la.
   */
  async function responder() {
    if (!atual || enviando) return;
    const texto = resposta.trim();
    if (!texto) return toast.error("Escreva a mensagem antes de enviar.");
    if (texto.length > MAX_RESPOSTA) return toast.error(`Mensagem longa demais (máx. ${MAX_RESPOSTA} caracteres).`);
    setEnviando(true);
    try {
      const { data, error } = await supabase.functions.invoke("sdr-whatsapp-broadcast", {
        body: { action: "human_reply", conversation_id: atual.id, text: texto },
      });
      if (error) throw error;
      setResposta("");
      // A function responde `persisted: false` quando a mensagem saiu e o
      // histórico não gravou. Pintar verde puro nesse caso esconderia que a
      // conversa na tela está incompleta.
      if (data?.persisted === false) toast.warning(String(data.warning ?? "Mensagem enviada, histórico incompleto."));
      else toast.success("Mensagem enviada ao lead pelo WhatsApp.");
      // A lista também: `last_message_at` acabou de andar (trigger
      // `sdr_messages_touch`), e sem reler a conversa continuaria com o selo
      // "parada há X h" logo depois de o operador ter respondido.
      await Promise.all([carregarMensagens(atual.id), load()]);
    } catch (e) {
      toast.error(await functionErrorMessage(e, "Não foi possível enviar a mensagem."));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_220px]">
        <Input
          aria-label="Buscar por nome ou telefone do lead"
          placeholder="Buscar pelo nome ou telefone do lead..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger aria-label="Filtrar por situação"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todas as situações</SelectItem>
            {Object.entries(STATUS_CONVERSA).map(([valor, rotulo]) => (
              <SelectItem key={valor} value={valor}>{rotulo}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!veTudo && (
        <p role="status" className="text-xs text-muted-foreground">
          Seu papel enxerga apenas conversas de leads da sua equipe — a lista pode aparecer vazia mesmo havendo
          conversas em andamento no módulo.
        </p>
      )}

      <div className="grid md:grid-cols-[320px,1fr] gap-3">
        <Card className="p-2 max-h-[520px] overflow-y-auto">
          {carregando && <LoadingState variant="list" rows={3} label="Carregando conversas…" />}
          {rowsError && <p className="text-xs text-destructive p-2">{rowsError}</p>}
          {!carregando && !rowsError && rows.length === 0 && (
            <p className="text-xs text-muted-foreground p-2">Sem conversas ainda.</p>
          )}
          {!carregando && !rowsError && rows.length > 0 && visiveis.length === 0 && (
            <p className="text-xs text-muted-foreground p-2">Nenhuma conversa com esse filtro.</p>
          )}
          {visiveis.map(r => {
            const parada = conversaParada(r);
            return (
              <button key={r.id} onClick={() => setSel(r.id)} aria-pressed={sel === r.id} className={`w-full text-left p-2 rounded text-xs hover:bg-muted ${sel === r.id ? "bg-muted" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <b className="truncate">{nomeDoLead(r)}</b>
                  <Badge variant="outline" size="sm">{r.score ?? "—"}</Badge>
                </div>
                <div className="text-muted-foreground truncate">
                  {STATUS_CONVERSA[r.status] ?? r.status}
                  {telefone(r) && ` · ${telefone(r)}`}
                </div>
                {/* A data é a da última MENSAGEM, a mesma grandeza do selo
                    "parada" logo abaixo. Com `updated_at`, assumir a conversa
                    (que grava `status`) reescrevia a data para agora e a linha
                    dizia "última mensagem agora · parada há 3 dias". */}
                <div className="text-muted-foreground truncate">
                  {agents.find(a => a.id === r.agent_id)?.name || "sem agente"}
                  {" · última mensagem em "}
                  {dateTime(r.last_message_at ?? r.updated_at)}
                </div>
                {/* Selo, não cor: a conversa parada precisa dizer isso por
                    escrito para quem não distingue o tom do texto. */}
                <div className="flex flex-wrap gap-1 pt-1 empty:hidden">
                  {ehSimulacao(r) && <Badge variant="outline" size="sm">Simulação do Playground</Badge>}
                  {parada?.parada && (
                    <Badge variant="outline" size="sm" className="border-warning text-warning">{parada.rotulo}</Badge>
                  )}
                </div>
              </button>
            );
          })}
          {!carregando && !rowsError && temMais && (
            <div className="p-2">
              <Button size="sm" variant="outline" className="w-full" disabled={buscandoMais} onClick={carregarMais}>
                {buscandoMais ? "Carregando…" : `Carregar mais ${PAGINA}`}
              </Button>
              <p className="text-xs text-muted-foreground pt-1">
                Mostrando as {rows.length} conversas mais recentes.
              </p>
            </div>
          )}
        </Card>

        <Card className="p-3 max-h-[520px] overflow-y-auto space-y-2">
          {!sel && <p className="text-xs text-muted-foreground">Selecione uma conversa.</p>}
          {atual && (
            <div className="flex flex-wrap items-start justify-between gap-2 border-b pb-2 mb-1">
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{nomeDoLead(atual)}</p>
                <p className="text-xs text-muted-foreground">
                  {STATUS_CONVERSA[atual.status] ?? atual.status}
                  {telefone(atual) && ` · ${telefone(atual)}`}
                  {atual.score !== null && ` · score ${atual.score}`}
                </p>
                {cadeia.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Passou por: {cadeia.join(" → ")}
                  </p>
                )}
                {atual.summary && <p className="text-xs text-muted-foreground mt-1">{atual.summary}</p>}
                {ehSimulacao(atual) && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Simulação do Playground: o lead é de teste (fora da roleta) e nada foi enviado por WhatsApp.
                  </p>
                )}
              </div>
              {canWrite && atual.status === "active" && (
                <Button size="sm" variant="outline" disabled={salvando} onClick={() => trocarStatus("human")}>
                  <Hand className="h-3.5 w-3.5 mr-1" />Assumir conversa
                </Button>
              )}
              {canWrite && atual.status === "human" && (
                <Button size="sm" variant="outline" disabled={salvando} onClick={() => trocarStatus("active")}>
                  <BotIcon className="h-3.5 w-3.5 mr-1" />Devolver ao robô
                </Button>
              )}
            </div>
          )}
          {sel && msgs === null && <LoadingState variant="list" rows={3} label="Carregando mensagens…" />}
          {sel && msgsError && <p className="text-xs text-destructive">{msgsError}</p>}
          {sel && msgs?.length === 0 && !msgsError && (
            <p className="text-xs text-muted-foreground">Esta conversa não tem mensagens registradas.</p>
          )}
          {(msgs || []).map(m => (
            <div key={m.id} className={`flex ${m.author === "lead" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                m.author === "lead" ? "bg-primary text-primary-foreground"
                  : m.author === "system" ? "border border-dashed text-muted-foreground"
                  : "bg-muted"
              }`}>
                {/* Quem falou, por escrito: sem isso a resposta do operador e a
                    do robô ficam com a mesma bolha cinza. */}
                {m.author === "broker" && <div className="text-xs text-muted-foreground mb-1">Operador</div>}
                {m.author === "agent" && m.agent_id && (
                  <div className="text-xs text-muted-foreground mb-1">{nomeDoAgente(m.agent_id)}</div>
                )}
                {m.body}
              </div>
            </div>
          ))}
          <div ref={fimDasMensagens} />

          {atual?.status === "human" && canWrite && (
            <div className="border-t pt-2 space-y-2">
              <p role="status" className="text-xs text-warning">
                Você assumiu esta conversa: o robô parou de responder. O que você escrever aqui sai pelo WhatsApp da
                empresa, no mesmo número, e fica gravado no histórico.
              </p>
              <Textarea
                aria-label="Sua resposta ao lead"
                placeholder="Escreva a resposta que o lead vai receber no WhatsApp…"
                rows={3}
                maxLength={MAX_RESPOSTA}
                value={resposta}
                onChange={(e) => setResposta(e.target.value)}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={enviando || !resposta.trim()} onClick={responder}>
                  <Send className="h-3.5 w-3.5 mr-1" />{enviando ? "Enviando…" : "Enviar pelo WhatsApp"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Precisa das credenciais da WhatsApp Cloud API no cofre. Sem elas o envio é recusado com o motivo —
                  nada é gravado como se tivesse saído.
                </p>
              </div>
            </div>
          )}
          {atual?.status === "human" && !canWrite && (
            <p role="status" className="text-xs text-muted-foreground border-t pt-2">
              Conversa assumida por um operador. Responder pelo CRM é de admin, marketing e SDR.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
