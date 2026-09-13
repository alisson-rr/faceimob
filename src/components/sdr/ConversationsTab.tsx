import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Hand, Bot as BotIcon, Send, CheckCircle2 } from "lucide-react";
import { describeError } from "@/lib/supabaseError";
import { functionErrorMessage } from "@/lib/functionError";
import { dateTime } from "@/lib/format";
import { UnmatchedThreads } from "./UnmatchedThreads";
import {
  acoesDaConversa, cadeiaDeAgentes, conversaParada, FILTRO_ABERTAS, FILTRO_TODAS, OPCOES_DE_SITUACAO,
  recorteDaSituacao, rotuloDoAutor, seloDeMidia, STATUS_CONVERSA,
  type Agent, type Conversation, type Message,
} from "./types";

/** Dono, resolução, autoria e mídia (0120) e a view de nomes ainda não estão no
 *  `types.ts` gerado; o cast morre no próximo `supabase gen types`. */
const untyped = supabase as unknown as SupabaseClient;

/** O lead vem embutido; `null` quando a RLS do papel não alcança aquele lead.
 *  `utm_source` separa a simulação do Playground (`sdr_playground`) da conversa
 *  de cliente de verdade — as duas moravam misturadas nesta lista. */
type Row = Conversation & {
  leads: { full_name: string; phone: string | null; phone_raw: string | null; utm_source: string | null } | null;
};

/** Quantas conversas por página. O corte existe porque a lista é uma coluna só;
 *  antes era um teto duro de 100 com um aviso e nenhuma saída. */
const PAGINA = 100;
/** Marca do lead de teste criado pelo `sdr-agent-chat` (PLAYGROUND_SOURCE). */
const ORIGEM_PLAYGROUND = "sdr_playground";
/** Mesmo teto do `humanReply` na edge function. */
const MAX_RESPOSTA = 4000;
/** A resposta do lead chega pelo webhook sem avisar a tela: a caixa se relê sozinha. */
const RECARGA_MS = 30_000;

/** Papéis que a policy `sdr_conversations_select` deixa ver TODAS as conversas.
 *  `partner` entra porque `has_any_role('admin', …)` o aceita desde a 0099; o
 *  gerente só vê as de leads da própria visibilidade — lista curta ou vazia é o
 *  esperado, não falha. */
const VE_TUDO = ["admin", "partner", "director", "marketing", "sdr"];

export function ConversationsTab({ agents, canWrite }: { agents: Agent[]; canWrite: boolean }) {
  const { roles, user } = useAuth();
  const eu = user?.id ?? null;
  const qc = useQueryClient();
  const veTudo = roles.some((r) => VE_TUDO.includes(r));
  const [sel, setSel] = useState<string>("");
  const [busca, setBusca] = useState("");
  const [situacao, setSituacao] = useState<string>(FILTRO_ABERTAS);
  // Quantas conversas a lista pede. Faz parte da chave: reler depois de gravar
  // (assumir, devolver, responder) relê a MESMA janela, e a conversa selecionada
  // além da centésima não some da tela no clique.
  const [janela, setJanela] = useState(PAGINA);
  const [salvando, setSalvando] = useState(false);
  const [resposta, setResposta] = useState("");
  const [enviando, setEnviando] = useState(false);
  const fimDasMensagens = useRef<HTMLDivElement>(null);

  const conversas = useQuery({
    queryKey: ["sdr", "conversas", situacao, janela],
    queryFn: async () => {
      // O filtro de situação vai ao banco: a lista é paginada. Ordem por
      // `last_message_at`, a mesma grandeza do selo "parada" e da data da
      // linha; por `updated_at`, assumir empurrava para o topo a conversa que
      // ninguém respondeu. `nullsFirst: false` joga para o fim a conversa sem
      // mensagem nenhuma.
      let consulta = untyped.from("sdr_conversations").select("*, leads(full_name, phone, phone_raw, utm_source)");
      const recorte = recorteDaSituacao(situacao);
      if (recorte) {
        consulta = recorte.op === "eq" ? consulta.eq("status", recorte.status) : consulta.neq("status", recorte.status);
      }
      const { data, error } = await consulta
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .range(0, janela - 1);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    placeholderData: keepPreviousData,
    refetchInterval: RECARGA_MS,
  });
  const rows = useMemo(() => conversas.data ?? [], [conversas.data]);
  const rowsError = conversas.error ? describeError(conversas.error, "Não foi possível carregar as conversas.") : null;
  // Página cheia = provavelmente há mais. Contar o total custaria uma consulta
  // que não muda nenhuma decisão da tela.
  const temMais = !conversas.isPlaceholderData && rows.length === janela;
  const buscandoMais = conversas.isFetching && conversas.isPlaceholderData;

  const mensagens = useQuery({
    queryKey: ["sdr", "mensagens", sel],
    queryFn: async () => {
      const { data, error } = await untyped
        .from("sdr_messages").select("*").eq("conversation_id", sel).order("created_at");
      if (error) throw error;
      return (data ?? []) as Message[];
    },
    enabled: !!sel,
    refetchInterval: RECARGA_MS,
  });
  const msgs = mensagens.data;
  const msgsError = mensagens.error ? describeError(mensagens.error, "Não foi possível carregar as mensagens.") : null;

  // Nome de quem responde, assume e resolve. `profiles_select` só mostra ao SDR
  // o próprio perfil; a view da 0120 expõe só id e nome dos operadores. Sem ela
  // o rótulo fica "Humano", nunca um nome chutado.
  const operadores = useQuery({
    queryKey: ["sdr", "operadores"],
    queryFn: async () => {
      const { data, error } = await untyped.from("sdr_operator_names").select("id, full_name");
      if (error) throw error;
      return (data ?? []) as { id: string; full_name: string }[];
    },
    staleTime: 5 * 60_000,
  });
  const nomes = useMemo(() => new Map((operadores.data ?? []).map((p) => [p.id, p.full_name])), [operadores.data]);
  const nomeDoOperador = useCallback((id: string) => nomes.get(id) ?? null, [nomes]);
  const quem = (id: string) => (id === eu ? "você" : nomeDoOperador(id) ?? "um operador");

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
    if (!termo) return rows;
    return rows.filter((r) => {
      const nome = (r.leads?.full_name || "").toLowerCase();
      const fone = (r.leads?.phone_raw || r.leads?.phone || "").replace(/\D/g, "");
      return nome.includes(termo) || (digitos.length >= 3 && fone.includes(digitos));
    });
  }, [rows, busca]);

  const atual = rows.find((r) => r.id === sel) ?? null;
  // A cadeia sai das MENSAGENS (`sdr_messages.agent_id`, migration 0082):
  // `sdr_conversations.agent_id` é sobrescrito a cada handoff e mostra só o
  // último agente.
  const cadeia = useMemo(() => cadeiaDeAgentes(msgs ?? [], nomeDoAgente), [msgs, nomeDoAgente]);
  const acoes = atual ? acoesDaConversa(atual, eu, canWrite) : null;

  const recarregar = () => qc.invalidateQueries({ queryKey: ["sdr", "conversas"] });

  /**
   * Assumir, devolver e resolver gravam `status` direto na tabela; quem assumiu
   * e quem resolveu é o gatilho da 0120 que carimba, com o usuário da sessão.
   * O filtro pelo status que a tela mostrava evita passar por cima de um
   * desfecho que chegou no meio. Zero linha é recusa da policy ou conversa que
   * mudou — nos dois casos nada foi gravado, e a lista é relida.
   */
  async function gravar(
    patch: Record<string, unknown>, deStatus: string[],
    aviso: { sucesso: string; detalhe?: string; falha: string }, conferirDono = false,
  ) {
    if (!atual) return false;
    setSalvando(true);
    let consulta = untyped.from("sdr_conversations").update(patch).eq("id", atual.id).in("status", deStatus);
    // Dois operadores assumindo juntos: só o primeiro leva, o outro vê a recusa.
    if (conferirDono) {
      consulta = atual.assumed_by ? consulta.eq("assumed_by", atual.assumed_by) : consulta.is("assumed_by", null);
    }
    const { data, error } = await consulta.select("id");
    setSalvando(false);
    if (error) {
      toast.error(aviso.falha, { description: describeError(error, "Tente de novo.") });
      return false;
    }
    if (!data?.length) {
      toast.error(aviso.falha, { description: "A conversa mudou enquanto você olhava ou seu papel não pode alterá-la." });
      void recarregar();
      return false;
    }
    toast.success(aviso.sucesso, { description: aviso.detalhe, duration: 2500 });
    await recarregar();
    return true;
  }

  const assumir = () => atual && gravar(
    { status: "human", assumed_by: eu }, [atual.status],
    { sucesso: "Conversa assumida", detalhe: "O robô não responde mais nela.", falha: "Não foi possível assumir a conversa" },
    true,
  );
  const devolver = () => gravar(
    { status: "active" }, ["human"],
    { sucesso: "Conversa devolvida ao robô", falha: "Não foi possível devolver a conversa ao robô" },
  );
  async function resolver() {
    const ok = await gravar(
      { status: "resolved" }, ["active", "human"],
      { sucesso: "Conversa resolvida", falha: "Não foi possível resolver a conversa" },
    );
    // Com o filtro que esconde a resolvida, a seleção apontaria para uma linha
    // que saiu da lista: o cabeçalho sumiria e as mensagens ficariam na tela.
    if (ok && situacao !== FILTRO_TODAS && situacao !== "resolved") setSel("");
  }

  /**
   * Resposta do operador, enviada de dentro do CRM.
   *
   * A function grava a mensagem SÓ depois de a Meta aceitar, e devolve 503 com
   * `code: missing_credential` quando falta o token da Cloud API — por isso o
   * texto digitado só é limpo quando o envio de fato saiu.
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
      // `persisted: false` = a mensagem saiu e o histórico não gravou. Verde
      // puro esconderia que a conversa na tela está incompleta.
      if (data?.persisted === false) toast.warning(String(data.warning ?? "Mensagem enviada, histórico incompleto."));
      else toast.success("Mensagem enviada", { description: "O lead recebe pelo WhatsApp." });
      // A lista também: `last_message_at` acabou de andar (trigger
      // `sdr_messages_touch`), e o selo "parada há X h" tem de sair.
      await Promise.all([qc.invalidateQueries({ queryKey: ["sdr", "mensagens", atual.id] }), recarregar()]);
    } catch (e) {
      toast.error("Não foi possível enviar a mensagem", { description: await functionErrorMessage(e, "Tente de novo.") });
    } finally {
      setEnviando(false);
    }
  }

  const listaVazia = situacao === FILTRO_ABERTAS
    ? "Nenhuma conversa em aberto."
    : situacao === FILTRO_TODAS ? "Sem conversas ainda." : "Nenhuma conversa com esse filtro.";

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_260px]">
        <Input
          aria-label="Buscar por nome ou telefone do lead"
          placeholder="Buscar pelo nome ou telefone do lead..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <Select value={situacao} onValueChange={(v) => { setSituacao(v); setJanela(PAGINA); }}>
          <SelectTrigger aria-label="Filtrar por situação"><SelectValue /></SelectTrigger>
          <SelectContent>
            {OPCOES_DE_SITUACAO.map((o) => (
              <SelectItem key={o.valor} value={o.valor}>{o.rotulo}</SelectItem>
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
          {conversas.isPending && <LoadingState variant="list" rows={3} label="Carregando conversas…" />}
          {rowsError && <p className="text-xs text-destructive p-2">{rowsError}</p>}
          {!conversas.isPending && !rowsError && rows.length === 0 && (
            <p className="text-xs text-muted-foreground p-2">{listaVazia}</p>
          )}
          {!conversas.isPending && rows.length > 0 && visiveis.length === 0 && (
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
                  {r.status === "human" && r.assumed_by && ` · ${quem(r.assumed_by)}`}
                  {telefone(r) && ` · ${telefone(r)}`}
                </div>
                {/* A data é a da última MENSAGEM, a mesma grandeza do selo
                    "parada" logo abaixo: assumir a conversa não a reescreve. */}
                <div className="text-muted-foreground truncate">
                  {agents.find(a => a.id === r.agent_id)?.name || "sem agente"}
                  {" · última mensagem em "}
                  {dateTime(r.last_message_at ?? r.updated_at)}
                </div>
                {/* Selo, não cor: a conversa parada e a humana sem dono precisam
                    dizer isso por escrito. */}
                <div className="flex flex-wrap gap-1 pt-1 empty:hidden">
                  {ehSimulacao(r) && <Badge variant="outline" size="sm">Simulação do Playground</Badge>}
                  {r.status === "human" && !r.assumed_by && (
                    <Badge variant="outline" size="sm" className="border-warning text-warning">Sem responsável</Badge>
                  )}
                  {parada?.parada && (
                    <Badge variant="outline" size="sm" className="border-warning text-warning">{parada.rotulo}</Badge>
                  )}
                </div>
              </button>
            );
          })}
          {!conversas.isPending && !rowsError && (temMais || buscandoMais) && (
            <div className="p-2">
              <Button size="sm" variant="outline" className="w-full" disabled={buscandoMais} onClick={() => setJanela(rows.length + PAGINA)}>
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
                {atual.status === "human" && (
                  <p className="text-xs text-muted-foreground">
                    {atual.assumed_by
                      ? `Assumida por ${quem(atual.assumed_by)}${atual.assumed_at ? ` em ${dateTime(atual.assumed_at)}` : ""}.`
                      : "Com humano, mas ninguém assumiu: os avisos de mensagem nova vão para todo o SDR até alguém assumir."}
                  </p>
                )}
                {atual.status === "resolved" && (
                  <p className="text-xs text-muted-foreground">
                    Resolvida{atual.resolved_by ? ` por ${quem(atual.resolved_by)}` : ""}
                    {atual.resolved_at ? ` em ${dateTime(atual.resolved_at)}` : ""}. Se o lead escrever de novo, ela volta
                    para a caixa.
                  </p>
                )}
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
              <div className="flex flex-wrap gap-2">
                {acoes?.assumir && (
                  <Button size="sm" variant="outline" disabled={salvando} onClick={assumir}>
                    <Hand className="h-3.5 w-3.5 mr-1" aria-hidden="true" />Assumir conversa
                  </Button>
                )}
                {acoes?.devolver && (
                  <Button size="sm" variant="outline" disabled={salvando} onClick={devolver}>
                    <BotIcon className="h-3.5 w-3.5 mr-1" aria-hidden="true" />Devolver ao robô
                  </Button>
                )}
                {acoes?.resolver && (
                  <Button size="sm" variant="outline" disabled={salvando} onClick={resolver}>
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" aria-hidden="true" />Marcar como resolvida
                  </Button>
                )}
              </div>
            </div>
          )}
          {sel && mensagens.isPending && <LoadingState variant="list" rows={3} label="Carregando mensagens…" />}
          {sel && msgsError && <p className="text-xs text-destructive">{msgsError}</p>}
          {sel && msgs?.length === 0 && !msgsError && (
            <p className="text-xs text-muted-foreground">Esta conversa não tem mensagens registradas.</p>
          )}
          {(msgs ?? []).map(m => {
            const midia = seloDeMidia(m);
            return (
              <div key={m.id} className={`flex ${m.author === "lead" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                  m.author === "lead" ? "bg-primary text-primary-foreground"
                    : m.author === "system" ? "border border-dashed text-muted-foreground"
                    : "bg-muted"
                }`}>
                  {/* Quem falou, por escrito, em toda bolha: a resposta do humano
                      e a do robô tinham a mesma bolha cinza. */}
                  <div className={`flex flex-wrap items-center gap-1 text-xs mb-1 ${
                    m.author === "lead" ? "text-primary-foreground" : "text-muted-foreground"
                  }`}>
                    <span>{rotuloDoAutor(m, nomeDoAgente, nomeDoOperador)}</span>
                    {midia && (
                      <Badge
                        variant="outline"
                        size="sm"
                        className={`bg-background ${midia.falhou ? "border-warning text-warning" : ""}`}
                      >
                        {midia.rotulo}
                      </Badge>
                    )}
                  </div>
                  {m.body}
                </div>
              </div>
            );
          })}
          <div ref={fimDasMensagens} />

          {atual && acoes?.responder && (
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
                  <Send className="h-3.5 w-3.5 mr-1" aria-hidden="true" />{enviando ? "Enviando…" : "Enviar pelo WhatsApp"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Precisa das credenciais da WhatsApp Cloud API no cofre. Sem elas o envio é recusado com o motivo —
                  nada é gravado como se tivesse saído.
                </p>
              </div>
            </div>
          )}
          {atual && canWrite && !acoes?.responder && atual.status !== "active" && (
            <p role="status" className="text-xs text-muted-foreground border-t pt-2">
              O robô não responde nesta conversa. Assuma a conversa para responder por aqui — os avisos de mensagem
              nova do lead passam a ir para você.
            </p>
          )}
          {atual && !canWrite && atual.status === "human" && (
            <p role="status" className="text-xs text-muted-foreground border-t pt-2">
              Conversa com um humano. Assumir, responder e resolver são de administrador, marketing e SDR.
            </p>
          )}
        </Card>
      </div>

      <UnmatchedThreads canWrite={canWrite} />
    </div>
  );
}
