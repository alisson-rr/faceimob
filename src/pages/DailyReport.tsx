import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Swords, Flame, Trophy, Sparkles, Lock, Loader2, Info, AlertTriangle, RefreshCw, TrendingUp, History, Pencil, Target, Users, ChevronDown, ChevronUp, BarChart3 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { describeError } from "@/lib/supabaseError";
import { num, parseBrl } from "@/lib/format";
import { tone } from "@/lib/tone";
import { differenceInCalendarDays, format, startOfMonth, eachDayOfInterval, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import logoWhite from "@/assets/logo-faceimob-white.png";
import { UpdateBanner } from "@/components/UpdateNotifier";
import { CompactFunnel, type FunnelStep } from "@/components/ComparativeFunnel";
import {
  DAILY_FIELDS as FIELDS,
  TARGET_SCOPE_LABEL,
  aggregateMonth,
  fromDailyEntry as fromRow,
  monthMissingDays,
  targetsFrom,
  zeroDailyRow as zeroRow,
  type DailyBrokerMonth as BrokerMonth,
  type DailyDayRecord as DayRecord,
  type DailyEntry,
  type DailyFieldKey as FieldKey,
  type DailyTargets,
  type FunnelTargetsRow,
} from "@/lib/dailyFunnel";

type Roster = { broker_id: string; broker_name: string; active?: boolean; is_custom?: boolean };
type TeamInfo = { team_id: string; team_name: string; has_pin: boolean };
type PublicDailyPayload = {
  team_id: string;
  team_name: string;
  has_pin: boolean;
  /**
   * "Hoje" para o banco. O Postgres roda em UTC e `public_daily_submit` grava
   * em `current_date`; depois das 21h em Brasília o navegador ainda está no
   * dia anterior. Mesma regra do check-in (0029): a data é do banco.
   */
  today_date?: string;
  /** Quando o link para de abrir (migration 0062). Null = link anterior a ela. */
  expires_at?: string | null;
  /** Meta vigente com o escopo de onde veio: equipe > diretor > global (0062). */
  targets?: FunnelTargetsRow | null;
  /** `active:false` = saiu da equipe MAS lançou neste mês (0062). */
  roster?: Array<{ profile_id: string; full_name: string; active?: boolean }>;
  today?: DailyEntry[];
  /** Mês corrente dia a dia, `{"2026-09-01": DayRecord}` (migration 0038). */
  month?: Record<string, DayRecord>;
};


type EntryState = Record<string, Record<FieldKey, number>>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Passo de 0,5 (venda dividida entre dois corretores) e teto da coluna
 * `numeric(6,1)`. O banco impõe o mesmo passo por constraint (0038); aqui só se
 * evita o erro de ida e volta. Aplicado ao SAIR do campo e no envio — nunca a
 * cada tecla, senão "0,6" viraria "0,5" debaixo do dedo de quem digita.
 */
const halfStep = (value: number) => Math.max(0, Math.min(9999, Math.round(value * 2) / 2));

/** Chave do rascunho de uma célula da grade. */
const cellKey = (brokerId: string, field: FieldKey) => `${brokerId}:${field}`;

/**
 * Quantos dias para trás este link corrige.
 *
 * O mesmo teto está em `public_daily_submit` (0080), que é a fronteira: aqui
 * ele só evita a ida e volta. Dois dias, e não o mês inteiro, porque um link
 * público que reescreve trinta dias é uma URL vazada capaz de reescrever o mês.
 */
const EDIT_WINDOW_DAYS = 2;

// Antes da 0038 a RPC só devolvia `today`. Enquanto a migration não estiver
// aplicada, o mês é só o dia de hoje — a tela não quebra, só mostra menos.
const monthOf = (payload: PublicDailyPayload | undefined, todayStr: string): Record<string, DayRecord> => {
  if (payload?.month) return payload.month;
  return payload?.today?.length ? { [todayStr]: { entries: payload.today } } : {};
};

/**
 * Dias preenchidos do mês: dia com LANÇAMENTO, não linha em `daily_reports`.
 *
 * Havia duas réguas no mesmo produto — o calendário e a pendência contavam
 * LINHA de relatório, o contador por corretor contava dia com lançamento — e
 * elas divergem exatamente no caso ruim: `public_daily_submit` grava o
 * relatório antes de percorrer as entradas e ignora corretor que não é da
 * equipe, então um envio que não casou ninguém deixa um relatório VAZIO. O dia
 * ficava verde no calendário, saía da lista de pendências e não tinha número
 * nenhum por trás. A régua agora é uma só, aqui e no `missing_days` da
 * diretoria (0080).
 */
const filledDatesOf = (month: Record<string, DayRecord>): string[] =>
  Object.keys(month).filter((iso) => (month[iso]?.entries?.length ?? 0) > 0).sort();

/**
 * `public_daily_submit` ganhou `p_notes` e `p_filled_by` na migration 0038;
 * `types.ts` é gerado (`supabase gen types`) e ainda não os conhece. O cast
 * local morre no próximo `gen types` — mesmo padrão de `AdminDailyTeams`.
 */
type SubmitArgs = {
  p_slug: string;
  p_pin: string | null;
  p_entries: Array<Record<string, string | number>>;
  p_notes: string | null;
  p_filled_by: string | null;
  /**
   * Dia que está sendo gravado (0080). Só vai no corpo quando NÃO é hoje.
   *
   * O front sobe antes do `db push` (o deploy do Vercel não espera a migration).
   * Mandando `p_date` sempre, num banco sem a 0080 o PostgREST devolveria
   * PGRST202 ("função não encontrada") em TODO envio e o Diário pararia de
   * gravar para todo mundo durante a janela de deploy. Sem `p_date` a chamada
   * casa com a assinatura da 0038, que grava hoje — que é justamente o dia.
   */
  p_date?: string;
};

/** Recusa POR DATA — diferente do `null` de recusa de acesso (0080). */
type SubmitResult = { error?: string; max_days_back?: number } | null;
const submitDaily = (args: SubmitArgs) =>
  (supabase.rpc as unknown as (
    fn: "public_daily_submit",
    args: SubmitArgs,
  ) => Promise<{ data: SubmitResult; error: { code?: string; message: string } | null }>)(
    "public_daily_submit",
    args,
  );

export default function DailyReport() {
  const params = useParams<{ teamId?: string; slug?: string }>();
  const identifier = params.slug || params.teamId || "";
  const isUuid = UUID_RE.test(identifier);
  // Só a RPC diz qual é a equipe. Antes o UUID da rota legada era aceito como
  // equipe resolvida, e a tela abria o formulário de uma equipe que ela nunca
  // conseguiu ler.
  const [resolvedTeamId, setResolvedTeamId] = useState<string | null>(null);
  const [team, setTeam] = useState<TeamInfo | null>(null);
  const [pin, setPin] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [roster, setRoster] = useState<Roster[]>([]);
  const [entries, setEntries] = useState<EntryState>({});
  /**
   * Texto cru da célula que está sendo digitada, por `bid:campo`.
   *
   * Sem ele não dá para digitar meio ponto: `type="number"` devolve "" enquanto
   * o texto é "0," (não é um número válido), o estado volta a 0 e o React
   * reescreve o campo apagando o separador. O número normalizado volta a mandar
   * no `onBlur`.
   */
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [filledBy, setFilledBy] = useState("");
  const [notes, setNotes] = useState("");
  /** Quem gravou o dia aberto no formulário (null = dia sem checkpoint). */
  const [dayFilledBy, setDayFilledBy] = useState<string | null>(null);
  // Chute do navegador até a RPC responder com `today_date`.
  const [todayStr, setTodayStr] = useState(format(new Date(), "yyyy-MM-dd"));
  const [date, setDate] = useState(todayStr);
  const [submitting, setSubmitting] = useState(false);
  const [xpBurst, setXpBurst] = useState(0);
  const [monthTotals, setMonthTotals] = useState<Record<FieldKey, number>>(zeroRow);
  const [missingDays, setMissingDays] = useState<string[]>([]);
  const [loadingMonth, setLoadingMonth] = useState(false);
  /**
   * A RPC devolveu `month`? Sem a 0038 aplicada ela não devolve, e aí "dia sem
   * checkpoint" e "dia que não dá para ler" são coisas diferentes: pintar todo
   * dia anterior de vermelho acusaria a equipe por um limite do banco.
   */
  const [monthAvailable, setMonthAvailable] = useState(true);
  const [filledDates, setFilledDates] = useState<string[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loadingDay, setLoadingDay] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [brokerMonth, setBrokerMonth] = useState<BrokerMonth>({});
  /** Quando o link para de abrir. Sem aviso, o gerente so descobre no dia. */
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  /** Slug já sondado sem PIN — a sondagem de montagem acontece uma vez só. */
  const probedSlug = useRef("");
  const [targets, setTargets] = useState<DailyTargets>(() => targetsFrom(null));
  const [expandedBroker, setExpandedBroker] = useState<Record<string, boolean>>({});


  // `public_daily_submit` (0009, endurecida na 0034) grava sempre
  // `report_date = current_date` e não recebe data: esta tela lança o
  // checkpoint DE HOJE — o hoje do banco, que a RPC devolve em `today_date`.
  const today = parseISO(todayStr);
  const todayFilled = filledDates.includes(todayStr);
  /**
   * Distância, em dias, entre o dia aberto e o hoje DO BANCO.
   *
   * Até a 0080 a RPC não recebia data e gravava sempre em `current_date`: o
   * gerente que errou ontem não tinha como arrumar, e não existe tela de
   * administração que edite daily passado. Agora corrige-se dentro da janela;
   * fora dela o dia continua abrindo só para conferir.
   */
  const daysBack = differenceInCalendarDays(today, parseISO(date));
  /** Dia anterior aberto pelo Histórico. */
  const viewingPastDay = daysBack > 0;
  /** Fora da janela (ou no futuro): dá para ler, não dá para gravar. */
  const readOnlyDay = daysBack < 0 || daysBack > EDIT_WINDOW_DAYS;
  // Sem `month` os totais do mês não existem: dizer "acumulado" e mostrar zero
  // seria afirmar que a equipe não produziu nada.
  const monthCardTitle = monthAvailable ? "Funil do mês — acumulado" : "Funil do mês — indisponível";
  const targetLabel = TARGET_SCOPE_LABEL[targets.scope] ?? "meta cadastrada";
  const monthCardSubtitle = monthAvailable
    ? `metas: 100 → ${num(targets.analises)}% → ${num(targets.aprovados)}% → ${num(targets.vendas)}% · ${targetLabel}`
    : "esta versão do banco devolve só o dia de hoje";
  /** As quatro etapas com a meta que está valendo — um lugar só, três cartões. */
  const funnelSteps = (values: Record<FieldKey, number>): FunnelStep[] => [
    { key: "leads",     label: "Leads",      value: values.leads     || 0, targetPct: 100 },
    { key: "analises",  label: "Análises",   value: values.analises  || 0, targetPct: targets.analises },
    { key: "aprovados", label: "Aprovações", value: values.aprovados || 0, targetPct: targets.aprovados },
    { key: "vendas",    label: "Vendas",     value: values.vendas    || 0, targetPct: targets.vendas },
  ];
  // O funil ideal desenhado com a meta que está valendo, não com 10/40/50 fixos.
  const round1 = (value: number) => Math.round(value * 10) / 10;
  const idealAnalises  = round1(targets.analises);
  const idealAprovados = round1((idealAnalises  * targets.aprovados) / 100);
  const idealVendas    = round1((idealAprovados * targets.vendas) / 100);
  // Validade: link vencido cai na mesma recusa de PIN errado (0033), sem
  // explicação nenhuma para quem preenche.
  const expiresInDays = expiresAt
    ? Math.floor((new Date(expiresAt).getTime() - Date.now()) / 86_400_000)
    : null;

  const activeRoster = useMemo(() => roster.filter((b) => b.active !== false), [roster]);

  // Lança em erro de RPC (rede/servidor); retorna null só quando o banco negou
  // o acesso (PIN errado). Antes os dois casos viravam "PIN incorreto".
  const fetchPublicTeam = useCallback(async (rawPin: string) => {
    const { data, error } = await supabase.rpc("public_daily_team", {
      p_slug: identifier,
      p_pin: rawPin || null,
    });
    if (error) throw error;
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    const payload = data as unknown as PublicDailyPayload;
    // `active:false` = corretor que saiu MAS lançou neste mês (0062). Sem ele no
    // roster, o total do mês somava a produção dele e a lista por corretor não o
    // mostrava: duas somas diferentes na mesma tela, sem aviso nenhum.
    const list = (payload.roster ?? []).map(row => ({
      broker_id: row.profile_id,
      broker_name: row.full_name,
      active: row.active !== false,
    })) as Roster[];
    setTeam({ team_id: payload.team_id, team_name: payload.team_name, has_pin: payload.has_pin });
    setResolvedTeamId(payload.team_id);
    setExpiresAt(payload.expires_at ?? null);
    setTargets(targetsFrom(payload.targets));
    if (payload.today_date) setTodayStr(payload.today_date);
    setRoster(list);
    setEntries((prev) => {
      const next: EntryState = { ...prev };
      list.forEach((b) => {
        if (!next[b.broker_id]) next[b.broker_id] = zeroRow();
      });
      return next;
    });
    return { payload, list };
  }, [identifier]);

  // Quem abre a grade é o `loadDay`, DEPOIS da guarda de acesso: abrir aqui
  // antes mostrava a grade zerada quando o banco recusava a leitura.
  const openTodayForm = () => loadDay(todayStr);



  /**
   * Põe na tela o mês que veio NESTA resposta.
   *
   * Separado do `loadMonth` porque quem acabou de destravar (ou de sondar sem
   * PIN) já tem o payload na mão: chamar `loadMonth()` ali disparava um SEGUNDO
   * `public_daily_team` com o mesmo PIN, um round-trip por abertura de tela.
   */
  const applyMonth = useCallback((payload: PublicDailyPayload) => {
    const dbToday = payload.today_date ?? todayStr;
    const month = payload.month;
    const dates = filledDatesOf(month ?? {});
    const { totals: mt, byBroker } = aggregateMonth(month ?? {});
    setMonthAvailable(month !== undefined);
    setMonthTotals(mt);
    // Sem `month` só se sabe de hoje, que vem em `today`: o resto do mês fica
    // desconhecido, não vazio.
    setFilledDates(month ? dates : (payload.today?.length ? [dbToday] : []));
    setBrokerMonth(byBroker);
    // Hoje fica de fora: ainda está aberto para preencher. Sábado e domingo
    // também — a mesma regra que a 0062 levou aos `missing_days` da diretoria.
    setMissingDays(!month ? [] : monthMissingDays(dates, dbToday));
  }, [todayStr]);

  const loadMonth = useCallback(async () => {
    setLoadingMonth(true);
    try {
    const result = await fetchPublicTeam(pin);
    // Recusa do banco (PIN renovado, link travado ou desativado) não é "mês
    // vazio": engolir o `null` zerava os totais e acusava o mês inteiro de não
    // preenchido. Mesma guarda de `handleUnlock`.
    if (!result) {
      return toast({
        title: "Acesso recusado",
        description: "PIN incorreto, ou o link está bloqueado por 15 minutos após 5 tentativas erradas.",
        variant: "destructive",
      });
    }
    applyMonth(result.payload);
    } catch (e) {
      console.error("daily report: falha ao carregar o mês", e);
      toast({
        title: "Não consegui carregar o mês",
        description: describeError(e, "Erro de conexão — tente novamente."),
        variant: "destructive",
      });
    } finally {
      setLoadingMonth(false);
    }
  }, [applyMonth, fetchPublicTeam, pin]);

  // Único lugar que põe um dia no formulário: hoje ou qualquer dia do mês que
  // veio em `month`. Dia sem checkpoint abre zerado, e só ele.
  const loadDay = async (targetDate: string) => {
    if (!resolvedTeamId) return;
    setLoadingDay(true);
    try {
    const result = await fetchPublicTeam(pin);
    // Recusa do banco não pode abrir o formulário: zerar a grade de um dia que
    // ESTÁ gravado apagaria da tela as observações e os números que o gerente
    // acabou de ver. Nada de `set*` antes desta guarda.
    if (!result) {
      return toast({
        title: "Acesso recusado",
        description: "PIN incorreto, ou o link está bloqueado por 15 minutos após 5 tentativas erradas.",
        variant: "destructive",
      });
    }
    const day = monthOf(result.payload, result.payload.today_date ?? todayStr)[targetDate];
    const rows = day?.entries ?? [];
    setDate(targetDate);
    setHistoryOpen(false);
    setFormOpen(true);
    setEntries(result.list.reduce((acc, b) => {
      acc[b.broker_id] = fromRow(rows.find((e) => e.profile_id === b.broker_id));
      return acc;
    }, {} as EntryState));
    // Rascunho é do dia que estava aberto: manter apagaria o valor do novo.
    setDraft({});
    setNotes(day?.notes ?? "");
    setDayFilledBy(day?.filled_by ?? null);
    // Dia sem gerente gravado: o nome que o gerente já digitou fica.
    if (day?.filled_by) setFilledBy(day.filled_by);
    } catch (e) {
      console.error("daily report: falha ao carregar o dia", e);
      toast({
        title: "Não consegui carregar o dia",
        description: describeError(e, "Erro de conexão — tente novamente."),
        variant: "destructive",
      });
    } finally {
      setLoadingDay(false);
    }
  };

  useEffect(() => {
    // `loadMonth` depende de `pin`, e sem esta trava o efeito refazia
    // `public_daily_team(slug, "")` a CADA TECLA digitada no campo do PIN.
    // `isUuid` fica de fora: a rota legada `/daily/<uuid>` não tem slug nenhum
    // para resolver e a chamada só voltaria null (a tela explica isso no lugar
    // do portão de PIN, que nunca abriria).
    if (!identifier || isUuid || probedSlug.current === identifier) return;
    probedSlug.current = identifier;
    (async () => {
      try {
        const result = await fetchPublicTeam("");
        if (result) {
          setUnlocked(true);
          // O payload desta resposta já traz o mês: `loadMonth()` aqui era um
          // segundo `public_daily_team` idêntico ao que acabou de voltar.
          applyMonth(result.payload);
        }
      } catch (e) {
        // Sem rede (ou RPC fora do contrato): mantém a tela de PIN, que é o
        // estado certo aqui; o botão "Entrar" avisa o erro. O log fica porque
        // PGRST202 e 42501 chegam por este caminho e sumiam sem deixar rastro.
        console.error("daily report: falha ao abrir a equipe sem PIN", e);
      }
    })();
  }, [applyMonth, fetchPublicTeam, identifier, isUuid]);


  const totals = useMemo(() => {
    const t: Record<FieldKey, number> = FIELDS.reduce((a, f) => ({ ...a, [f.key]: 0 }), {} as Record<FieldKey, number>);
    Object.values(entries).forEach((row) => FIELDS.forEach((f) => { t[f.key] += row[f.key] || 0; }));
    return t;
  }, [entries]);

  const xpEarned = totals.vendas * 100 + totals.aprovados * 40 + totals.analises * 10 + totals.leads;
  const xpMonth = monthTotals.vendas * 100 + monthTotals.aprovados * 40 + monthTotals.analises * 10 + monthTotals.leads;
  const xpDisplay = formOpen ? xpEarned : xpMonth;


  const emptyBrokers = useMemo(() => {
    return activeRoster.filter((b) => {
      const row = entries[b.broker_id];
      if (!row) return true;
      // "sem lançamento" = nenhum campo com valor > 0 (0/undefined/null contam como vazio).
      return FIELDS.every((f) => !row[f.key]);
    });
  }, [activeRoster, entries]);


  const handleUnlock = async () => {
    // Piso igual ao do servidor (0062: `^[0-9]{6,10}$`). Um PIN de 4 ou 5
    // dígitos JAMAIS pode existir no banco, mas a tentativa chegava lá e
    // `resolve_public_link` (0033) contava o erro: cinco digitações curtas
    // trancavam o link do gerente por 15 minutos por um PIN impossível.
    if (pin.length < 6) {
      return toast({
        title: "O PIN tem de 6 a 10 dígitos",
        description: "Confira o código entregue pela administração antes de tentar — cada erro conta para o bloqueio de 15 minutos.",
      });
    }
    let result;
    try {
      result = await fetchPublicTeam(pin);
    } catch (e) {
      console.error("daily report: falha ao abrir a equipe", e);
      return toast({
        title: "Erro de conexão — tente novamente",
        description: describeError(e, "Não foi possível falar com o servidor."),
        variant: "destructive",
      });
    }
    if (!result) {
      // O mesmo NULL cobre PIN errado, link vencido e link travado (0033/0062):
      // este era o único caminho da tela que não dizia isso, e é justamente por
      // onde o gerente erra o PIN.
      return toast({
        title: "PIN incorreto",
        description: "Depois de 5 tentativas erradas o link fica bloqueado por 15 minutos. Se o link venceu, peça um novo à administração.",
        variant: "destructive",
      });
    }
    const list = result.list;
    const initial: EntryState = {};
    list.forEach((b) => {
      initial[b.broker_id] = FIELDS.reduce((acc, f) => ({ ...acc, [f.key]: 0 }), {} as Record<FieldKey, number>);
    });
    setEntries(initial);
    setDraft({});
    setUnlocked(true);
    // `result` acabou de trazer o mês inteiro: `loadMonth()` aqui repetia a
    // mesma chamada com o mesmo PIN, um round-trip por destravamento.
    applyMonth(result.payload);
  };

  /** Enquanto digita: guarda o texto e o número que já dá para ler dele. */
  const setField = (bid: string, key: FieldKey, val: string) => {
    // Só dígito e separador decimal: "e", "-" e "+" passariam num campo de texto.
    const text = val.replace(/[^\d.,]/g, "");
    setDraft((prev) => ({ ...prev, [cellKey(bid, key)]: text }));
    setEntries((prev) => ({ ...prev, [bid]: { ...prev[bid], [key]: parseBrl(text) ?? 0 } }));
  };

  /** Ao sair do campo: o número volta ao passo de 0,5 e o rascunho sai de cena. */
  const commitField = (bid: string, key: FieldKey) => {
    setEntries((prev) => ({ ...prev, [bid]: { ...prev[bid], [key]: halfStep(prev[bid]?.[key] ?? 0) } }));
    setDraft((prev) => {
      const next = { ...prev };
      delete next[cellKey(bid, key)];
      return next;
    });
  };

  const submit = async () => {
    // O envio manda a DATA do dia aberto (0080). Fora da janela o banco recusa
    // com `date_out_of_window`; o botão já vem desabilitado e o guard fica aqui
    // porque é por onde todo envio passa.
    if (readOnlyDay) {
      return toast({
        title: "Este dia não pode mais ser corrigido por aqui",
        description: `O link corrige o checkpoint de hoje e dos ${EDIT_WINDOW_DAYS} dias anteriores. Para um dia mais antigo, fale com a administração.`,
        variant: "destructive",
      });
    }
    if (!filledBy.trim()) {
      toast({ title: "Informe seu nome no campo 'Gerente' antes de salvar", variant: "destructive" });
      const el = document.getElementById("filled-by-input") as HTMLInputElement | null;
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      el?.focus();
      return;
    }
    setSubmitting(true);
    // `halfStep` de novo aqui porque salvar com Enter não passa pelo `onBlur`:
    // fora do passo de 0,5 o banco recusa a equipe inteira com 23514 (0038).
    // Só a escala ativa: quem saiu aparece na tela por causa do mês (0062), com
    // os campos desabilitados, e a RPC ignoraria a linha dele de qualquer jeito.
    const payload = activeRoster.map((b) => {
      const row = entries[b.broker_id];
      const v = (key: FieldKey) => halfStep(row?.[key] || 0);
      return {
        profile_id: b.broker_id,
        leads: v("leads"),
        calls: v("ligacoes"),
        doc_collections: v("coleta_docs"),
        visits_scheduled: v("visitas_agendadas"),
        visits_done: v("visitas_realizadas"),
        analyses_sent: v("analises"),
        analyses_approved: v("aprovados"),
        sales: v("vendas"),
      };
    });
    const { data, error } = await submitDaily({
      p_slug: identifier,
      p_pin: pin || null,
      p_entries: payload,
      p_notes: notes.trim() || null,
      p_filled_by: filledBy.trim(),
      // A data do dia ABERTO, e só quando ele não é hoje: é o que faz a
      // correção de ontem cair na linha de ontem em vez de sobrescrever o
      // checkpoint de hoje.
      ...(viewingPastDay ? { p_date: date } : {}),
    });
    setSubmitting(false);
    if (error) {
      // A mensagem crua do Postgres cita tabela e constraint; fica no log, não na tela.
      console.error("daily report: falha ao enviar o checkpoint", error);
      // Banco ainda sem a 0080: a assinatura com data não existe. Só a CORREÇÃO
      // depende dela — o checkpoint de hoje continua gravando normalmente —, e
      // "função não encontrada" não diz nada a quem está do outro lado.
      if (error.code === "PGRST202" && viewingPastDay) {
        return toast({
          title: "A correção de dias anteriores ainda não está disponível",
          description: "O banco desta instalação ainda não recebeu a atualização que permite corrigir o passado pelo link. O checkpoint de hoje continua funcionando; para o dia anterior, fale com a administração.",
          variant: "destructive",
        });
      }
      return toast({
        title: "Falha ao enviar o checkpoint",
        description: describeError(error, "Não foi possível enviar o checkpoint. Tente de novo."),
        variant: "destructive",
      });
    }
    // Desde a 0034 a recusa vem como `null` com HTTP 200, não como exceção:
    // sinalizar por exceção fazia o PostgREST abortar a transação e apagava
    // junto a tentativa que o lockout tinha acabado de contar. Sem este `!data`
    // a tela comemoraria "+XP" para um envio que não gravou linha nenhuma.
    if (!data) {
      return toast({
        title: "Envio recusado",
        description: "PIN incorreto, ou o link está bloqueado por 15 minutos após 5 tentativas erradas. Peça um PIN novo à administração.",
        variant: "destructive",
      });
    }
    // Recusa POR DATA vem como objeto, não como `null`: dizer "PIN incorreto"
    // aqui acusaria de PIN errado quem acertou o PIN.
    if (data.error) {
      return toast({
        title: "Dia fora da janela de correção",
        description: `Este link grava o checkpoint de hoje e dos ${data.max_days_back ?? EDIT_WINDOW_DAYS} dias anteriores. Para um dia mais antigo, fale com a administração.`,
        variant: "destructive",
      });
    }
    setXpBurst(xpEarned);
    setDayFilledBy(filledBy.trim());
    toast({
      title: "🎯 Checkpoint concluído!",
      description: viewingPastDay
        ? `Correção gravada no dia ${format(parseISO(date), "dd/MM", { locale: ptBR })} — ${num(xpEarned)} pontos naquele dia.`
        : `${num(xpEarned)} pontos no placar do dia. Dados da equipe registrados.`,
    });
    setTimeout(() => setXpBurst(0), 3000);
    if (resolvedTeamId) loadMonth();
  };

  if (!identifier) return <div className="p-8 text-center">Equipe inválida.</div>;

  /**
   * Rota legada `/daily/<uuid>` (e `/daily/<uuid>/<slug>`, que cai aqui pelo
   * `params.teamId`).
   *
   * O identificador do link virou slug sorteado na 0033; o UUID da equipe não
   * resolve link nenhum, então a RPC devolvia `null` e a tela ficava PRESA no
   * portão de PIN — o gerente digitava o PIN certo e ouvia "PIN incorreto" para
   * sempre. Endereço morto tem que dizer que morreu.
   */
  if (isUuid) {
    return (
      <div className="gradient-premium min-h-screen bg-background text-foreground flex items-center justify-center p-6">
        <Card className="max-w-md border-warning/40 bg-card/60 backdrop-blur-xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-warning" /> Este endereço do Diário é antigo
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground">
            <p>
              O link do Diário passou a usar um código sorteado no lugar do número da equipe.
              Este endereço não abre mais nenhuma equipe — não adianta digitar o PIN.
            </p>
            <p>
              Peça o link novo à administração (tela <b>Diário — Links, PINs &amp; IPs</b>).
              O PIN continua o mesmo, quem muda é o endereço.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="gradient-premium min-h-screen bg-background text-foreground">
      {/* Aura */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[800px] h-[800px] rounded-full bg-primary/10 blur-3xl animate-pulse" />
      </div>

      <div className="relative max-w-6xl mx-auto p-6 space-y-6">
        <header className="text-center space-y-3">
          <img src={logoWhite} alt="Faceimob" className="h-12 mx-auto object-contain" />
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/10 text-xs uppercase tracking-widest">
            <Swords className="h-3 w-3 text-primary" /> Checkpoint Diário
          </div>
          <h1 className="text-4xl font-black bg-gradient-to-r from-primary via-info to-chart-5 bg-clip-text text-transparent">
            {/* Sem PIN a RPC não devolve a equipe (0062, seção 8): dizer
                "Carregando equipe..." na tela de PIN é um carregamento que
                nunca termina — e é o estado inicial de TODA visita. */}
            {team?.team_name ?? (unlocked ? "Carregando equipe…" : "Checkpoint da equipe")}
          </h1>
          <p className="text-xs text-muted-foreground">Registre a performance da sua equipe de hoje</p>
        </header>

        <UpdateBanner />

        {unlocked && expiresInDays !== null && expiresInDays <= 15 && (
          <div role="alert" className="rounded-md border border-warning/40 bg-warning/10 p-2 flex items-start gap-2 text-xs">
            <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-warning">
                {expiresInDays < 0
                  ? "Este link já venceu"
                  : `Este link vence em ${expiresInDays} dia${expiresInDays === 1 ? "" : "s"}`}
              </p>
              <p className="text-muted-foreground mt-0.5">
                Depois disso ele para de abrir e a tela vai dizer só “PIN incorreto”.
                Peça a renovação à administração antes da data.
              </p>
            </div>
          </div>
        )}

        {!unlocked ? (
          <Card className="max-w-md mx-auto border-primary/30 bg-card/60 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg"><Lock className="h-4 w-4 text-primary" /> Acesso da Equipe</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">Digite o PIN entregue pela administração — de 6 a 10 dígitos.</p>
              <Input
                type="password" inputMode="numeric" maxLength={10}
                aria-label="PIN da equipe"
                value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                placeholder="••••••"
                className="text-center text-2xl tracking-[0.5em] font-bold h-14"
                onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
              />
              <Button onClick={handleUnlock} className="w-full" size="lg">
                <Sparkles className="h-4 w-4 mr-2" /> Entrar na missão
              </Button>
              {team && !team.has_pin && (
                <p className="text-xs text-warning">⚠️ Nenhum PIN configurado. Contate o admin.</p>
              )}
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Meta bar */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Card className="border-primary/30 bg-card/60 backdrop-blur-xl">
                <CardContent className="p-3">
                  <label htmlFor="daily-date-input" className="text-xs uppercase text-muted-foreground">
                    Data {formOpen && viewingPastDay ? (readOnlyDay ? "(dia anterior — só leitura)" : "(dia anterior — correção)") : "(hoje)"}
                  </label>
                  {/* Sem `[color-scheme:dark]`: o esquema acompanha o tema pelo
                      CSS base, e forçá-lo deixava o seletor escuro no tema claro. */}
                  <Input id="daily-date-input" type="date" value={formOpen ? date : todayStr} readOnly disabled className="h-8 text-xs opacity-70 cursor-not-allowed" />

                </CardContent>
              </Card>
              <Card className={`bg-card/60 backdrop-blur-xl ${!filledBy.trim() && formOpen ? "border-destructive/60 ring-2 ring-destructive/30 animate-pulse" : "border-primary/30"}`}>
                <CardContent className="p-3">
                  <label htmlFor="filled-by-input" className="text-xs uppercase text-muted-foreground">Gerente {!filledBy.trim() && formOpen && <span className="text-destructive">*obrigatório</span>}</label>
                  <Input id="filled-by-input" value={filledBy} onChange={(e) => setFilledBy(e.target.value)} placeholder="Seu nome" className="h-8 text-xs" />
                </CardContent>
              </Card>
              <TooltipProvider>
                <Card className="border-warning/40 bg-warning/5 backdrop-blur-xl">
                  <CardContent className="p-3 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-1">
                        <p className="text-xs uppercase text-muted-foreground">{formOpen ? "Pontos do checkpoint" : "Pontos do mês"}</p>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button type="button" aria-label="Como os pontos do checkpoint são calculados">
                              <Info className="h-3 w-3 text-muted-foreground hover:text-warning" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="text-xs max-w-[260px]">
                            <p className="font-bold mb-1">Como é calculado:</p>
                            <ul className="space-y-0.5">
                              <li>• Venda = <b>100 pontos</b></li>
                              <li>• Análise aprovada = <b>40 pontos</b></li>
                              <li>• Análise enviada = <b>10 pontos</b></li>
                              <li>• Lead recebido = <b>1 ponto</b></li>
                            </ul>
                            <p className="mt-2 text-xs text-muted-foreground">Fechado: acumulado do mês. Editando: o placar do dia.</p>
                            {/* O ranking da temporada é alimentado por `game_events`
                                (negócio fechado, esteira), e o Diário não escreve lá.
                                Chamar isto de XP prometia uma pontuação que nunca era
                                creditada. */}
                            <p className="mt-1 text-xs text-warning">Placar do esforço do dia — não entra no ranking da temporada, que conta negócios fechados.</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <p className="text-xl font-black text-warning">{num(xpDisplay)}</p>
                    </div>

                    <Trophy className="h-8 w-8 text-warning" />
                  </CardContent>
                </Card>
              </TooltipProvider>
            </div>

            {/* Funil do mês — sempre visível para acompanhamento */}
            <CompactFunnel
              title={monthCardTitle}
              subtitle={monthCardSubtitle}
              accent={tone("chart-5")}
              steps={funnelSteps(monthTotals)}
            />

            {/* Funil IDEAL — 4 estágios 3D, compacto */}
            {/* `flex-wrap`: a tira tem rótulo + SVG de 96px + coluna de metas +
                painel de texto, e a 375 px isso não cabe numa linha — era a
                única fonte de rolagem horizontal da página (medido: 463 px de
                conteúdo em 375 px de viewport; com o wrap, 375). */}
            <div className="flex flex-wrap items-center gap-4 px-3 py-2 rounded-lg border border-border/40 bg-muted/10">
              <div className="flex items-center gap-1.5 shrink-0">
                <Target className="h-3.5 w-3.5 text-warning/80" />
                <span className="text-xs uppercase tracking-wider text-muted-foreground">Funil Ideal</span>
              </div>

              <svg viewBox="0 0 140 160" className="h-24 shrink-0" preserveAspectRatio="xMidYMid meet">
                <defs>
                  {/* O volume vem da opacidade sobre o fundo do card, não de
                      três azuis fixos: assim o funil acompanha o tema. */}
                  <linearGradient id="funil3d" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%"   stopColor={tone("primary", 0.55)} />
                    <stop offset="50%"  stopColor={tone("primary")} />
                    <stop offset="100%" stopColor={tone("primary", 0.5)} />
                  </linearGradient>
                </defs>
                {[
                  { y: 2,   top: 130, bot: 100, h: 22 },
                  { y: 40,  top: 100, bot: 74,  h: 20 },
                  { y: 76,  top: 74,  bot: 48,  h: 18 },
                  { y: 110, top: 48,  bot: 26,  h: 16 },
                ].map((s, i) => {
                  const cx = 70;
                  const topRx = s.top / 2, botRx = s.bot / 2;
                  const yTop = s.y, yBot = s.y + s.h;
                  const ellipseRy = topRx * 0.18;
                  // Body path: trapezoid sides + bottom ellipse arc
                  const d = `
                    M ${cx - topRx} ${yTop}
                    L ${cx - botRx} ${yBot}
                    A ${botRx} ${botRx * 0.22} 0 0 0 ${cx + botRx} ${yBot}
                    L ${cx + topRx} ${yTop}
                    A ${topRx} ${ellipseRy} 0 0 1 ${cx - topRx} ${yTop} Z
                  `;
                  return (
                    <g key={i}>
                      <path d={d} fill="url(#funil3d)" stroke={tone("border")} strokeWidth="0.5" />
                      {/* Top ellipse rim highlight */}
                      <ellipse cx={cx} cy={yTop} rx={topRx} ry={ellipseRy} fill={tone("primary", 0.7)} opacity="0.9" />
                      <ellipse cx={cx} cy={yTop - 0.4} rx={topRx * 0.95} ry={ellipseRy * 0.7} fill="none" stroke={tone("primary-foreground", 0.6)} strokeWidth="0.5" opacity="0.6" />
                    </g>
                  );
                })}
              </svg>

              <div className="flex flex-col justify-between h-24 py-1 text-xs leading-tight">
                <div className="flex items-center gap-1.5"><span className="text-muted-foreground">→</span><b className="text-foreground">100%</b><span className="text-muted-foreground">Leads</span></div>
                <div className="flex items-center gap-1.5"><span className="text-muted-foreground">→</span><b className="text-foreground">{num(targets.analises)}%</b><span className="text-muted-foreground">Análises</span></div>
                <div className="flex items-center gap-1.5"><span className="text-muted-foreground">→</span><b className="text-foreground">{num(targets.aprovados)}%</b><span className="text-muted-foreground">Aprovações</span></div>
                <div className="flex items-center gap-1.5"><span className="text-muted-foreground">→</span><b className="text-foreground">{num(targets.vendas)}%</b><span className="text-muted-foreground">Vendas</span></div>
              </div>


              <div className="flex-1 min-w-0 border-l border-border/40 pl-4 ml-1 text-xs leading-snug space-y-1">
                <p className="text-xs uppercase tracking-wider text-warning/80 font-semibold">Instrua seu time</p>
                <p className="text-muted-foreground">
                  A cada <b className="text-foreground">100 leads</b> trabalhados, o esperado é ({targetLabel}):
                </p>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-foreground">
                  <span><b className="text-info">{num(idealAnalises)}</b> análises</span>
                  <span className="text-muted-foreground">→</span>
                  <span><b className="text-success">{num(idealAprovados)}</b> aprovações</span>
                  <span className="text-muted-foreground">→</span>
                  <span><b className="text-warning">{num(idealVendas)}</b> vendas</span>
                </div>
                <p className="text-muted-foreground pt-0.5">
                  Cálculo: 100 × {num(targets.analises)}% = <b className="text-foreground">{num(idealAnalises)}</b>
                  {" · "}{num(idealAnalises)} × {num(targets.aprovados)}% = <b className="text-foreground">{num(idealAprovados)}</b>
                  {" · "}{num(idealAprovados)} × {num(targets.vendas)}% = <b className="text-foreground">{num(idealVendas)}</b>
                </p>
              </div>
            </div>



            {/* Month funnel + missing days */}
            <Card className="border-info/30 bg-card/60 backdrop-blur-xl">
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-info" /> Funil do mês ({format(today, "MMMM", { locale: ptBR })})
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {monthAvailable
                      // "Mês" na diretoria é o mês da SEMANA navegada; aqui é
                      // sempre o corrente. Quem vem do checkpoint navegando em
                      // agosto abre este link e vê setembro — dito, deixa de ser
                      // divergência silenciosa entre as duas telas.
                      ? `Do dia 1 até hoje, todos os corretores da equipe · este link mostra sempre o mês corrente (${format(today, "MMMM", { locale: ptBR })}); meses anteriores só no checkpoint interno`
                      : "Somente hoje — o histórico do mês não está disponível nesta versão do banco"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm" variant="outline" className="h-7 text-xs">
                        <History className="h-3 w-3 mr-1" /> Histórico
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-lg">
                      <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-base">
                          <History className="h-4 w-4" /> Histórico do mês
                        </DialogTitle>
                      </DialogHeader>
                      <div className="space-y-3">
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-success" /> Preenchido</span>
                          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-destructive" /> Não preenchido</span>
                          {!monthAvailable && (
                            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-muted" /> Sem informação</span>
                          )}
                        </div>
                        <div className="grid grid-cols-7 gap-1.5">
                          {/* Do dia 1 até o hoje do banco: é o recorte que `month` cobre. */}
                          {eachDayOfInterval({ start: startOfMonth(today), end: today }).map((d) => {
                            const ds = format(d, "yyyy-MM-dd");
                            const done = filledDates.includes(ds);
                            // Sem `month`, de dia anterior não se sabe nada: nem
                            // que está pendente, nem o que abrir na grade.
                            const unknown = !monthAvailable && ds !== todayStr;
                            return (
                              <button
                                key={ds}
                                onClick={() => loadDay(ds)}
                                disabled={loadingDay || unknown}
                                className={`relative aspect-square rounded-md text-xs font-bold flex flex-col items-center justify-center transition border ${
                                  unknown
                                    ? "bg-muted/20 border-border/40 text-muted-foreground cursor-not-allowed"
                                    : done
                                    ? "bg-success/15 border-success/50 text-success hover:bg-success/25"
                                    : "bg-destructive/10 border-destructive/40 text-destructive hover:bg-destructive/20"
                                }`}
                                title={
                                  unknown
                                    ? "Sem informação — esta versão do banco só devolve o dia de hoje"
                                    : ds === todayStr
                                    ? (done ? "Hoje — clique para editar o checkpoint" : "Hoje — clique para preencher")
                                    : differenceInCalendarDays(today, d) <= EDIT_WINDOW_DAYS
                                    ? "Dia anterior — clique para corrigir"
                                    : `Dia anterior — abre só para conferir; este link corrige até ${EDIT_WINDOW_DAYS} dias para trás`
                                }
                                /* "Preenchido" e "não preenchido" eram só cor de
                                   fundo mais um ícone sem nome: o nome acessível
                                   ("01 seg") era idêntico nos dois estados e o
                                   `title` não aparece em foco por teclado nem em
                                   toque. O rótulo REPETE o texto visível antes de
                                   acrescentar o estado (WCAG 2.5.3, "Label in
                                   Name") — quem usa comando de voz continua
                                   pedindo "01 seg". */
                                aria-label={`${format(d, "dd")} ${format(d, "EEE", { locale: ptBR })} — ${
                                  unknown ? "sem informação" : done ? "preenchido" : "não preenchido"
                                }`}
                              >
                                <span className="text-sm leading-none">{format(d, "dd")}</span>
                                <span className="text-xs uppercase mt-0.5 opacity-70">{format(d, "EEE", { locale: ptBR })}</span>
                                {done && <Pencil aria-hidden className="absolute top-0.5 right-0.5 h-2.5 w-2.5 opacity-70" />}
                              </button>
                            );
                          })}
                        </div>
                        {loadingDay && <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Carregando…</p>}
                      </div>
                    </DialogContent>
                  </Dialog>
                  <Button size="sm" variant="outline" onClick={() => resolvedTeamId && loadMonth()} disabled={loadingMonth} className="h-7 text-xs">
                    {loadingMonth ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                    Atualizar
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-8 gap-2 justify-items-center max-w-3xl mx-auto">
                  {FIELDS.map(f => (
                    <div key={f.key} className="px-2 py-1.5 rounded-md border border-border/40 bg-secondary/20 text-center">
                      <p className="text-xs uppercase text-muted-foreground">{f.label}</p>
                      <p className={`text-lg font-black ${f.color}`}>{num(monthTotals[f.key])}</p>
                    </div>
                  ))}
                </div>
                {/* "Não preenchido" e "não sei" são estados diferentes: sem a
                    migration 0038 a RPC não devolve o mês, e acusar 20 dias de
                    pendência seria culpar a equipe por um limite do banco. */}
                {!monthAvailable ? (
                  <div className="rounded-md border border-warning/40 bg-warning/10 p-2 flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                    <div className="text-xs">
                      <p className="font-bold text-warning">Histórico do mês indisponível nesta versão do banco</p>
                      <p className="text-muted-foreground mt-0.5">
                        Os totais acima e o Histórico cobrem só o dia de hoje. O checkpoint de hoje continua normal.
                      </p>
                    </div>
                  </div>
                ) : missingDays.length > 0 && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                    <div className="text-xs">
                      <p className="font-bold text-destructive">Checkpoint não efetuado ({missingDays.length} {missingDays.length === 1 ? "dia" : "dias"}):</p>
                      <p className="text-muted-foreground mt-0.5">
                        {missingDays.map(d => format(parseISO(d), "dd/MM", { locale: ptBR })).join(" • ")}
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>


            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Users className="h-3 w-3" /> {activeRoster.length} corretor{activeRoster.length === 1 ? "" : "es"} ativo{activeRoster.length === 1 ? "" : "s"}
                {roster.length !== activeRoster.length && <span className="text-destructive ml-1">• {roster.length - activeRoster.length} desligado{roster.length - activeRoster.length === 1 ? "" : "s"}</span>}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => setManageOpen(true)}
              >
                <Users className="h-3 w-3 mr-1" /> Corretores da equipe
              </Button>
            </div>

            <Dialog open={manageOpen} onOpenChange={setManageOpen}>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2"><Users className="h-4 w-4 text-primary" /> Corretores da equipe</DialogTitle>
                </DialogHeader>
                <p className="text-xs text-muted-foreground">
                  A escala do diário acompanha os membros ativos da equipe. Para
                  incluir ou desligar corretores, o gestor logado usa a tela <b>Equipes</b>.
                </p>
                <div className="max-h-72 overflow-auto divide-y divide-border/40 rounded-md border border-border/40">
                  {roster.map((b) => (
                    <div key={b.broker_id} className="px-3 py-2 text-xs">
                      <p className="font-medium truncate">
                        {b.broker_name}
                        {/* Quem saiu só aparece porque lançou neste mês (0062):
                            sem o rótulo, a lista pareceria escala atual. */}
                        {b.active === false && <span className="ml-1 uppercase text-destructive">(desligado — lançou no mês)</span>}
                      </p>
                    </div>
                  ))}
                  {roster.length === 0 && <p className="p-4 text-center text-xs text-muted-foreground">Nenhum corretor.</p>}
                </div>
              </DialogContent>
            </Dialog>



            {!formOpen ? (

              <Card className="border-primary/40 bg-gradient-to-br from-primary/10 via-chart-5/5 to-primary/10 backdrop-blur-xl">
                <CardContent className="p-6 flex flex-col items-center gap-3 text-center">
                  <Sparkles className="h-8 w-8 text-primary" />
                  <div>
                    <p className="text-sm font-bold">Pronto para registrar o dia de hoje?</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Clique abaixo para abrir o checkpoint de <b>hoje ({format(today, "dd/MM", { locale: ptBR })})</b> com todos os corretores da equipe.
                    </p>
                    {todayFilled && (
                      <p className="text-xs text-success mt-2 flex items-center justify-center gap-1">
                        <Info className="h-3 w-3" /> O checkpoint de hoje já foi preenchido — você pode editar os valores.
                      </p>
                    )}
                  </div>
                  <Button size="lg" onClick={openTodayForm} disabled={loadingDay || roster.length === 0} className="bg-gradient-to-r from-primary to-chart-5 hover:opacity-90">
                    {loadingDay ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Pencil className="h-4 w-4 mr-2" />}
                    {todayFilled ? "Editar daily de hoje" : "Preencher o daily de hoje"}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    O <b>Histórico</b> acima abre os outros dias: dá para corrigir até <b>{EDIT_WINDOW_DAYS} dias</b> para trás; mais antigo que isso, só conferir.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Broker cards */}
                {roster.length === 0 ? (
                  <Card className="p-8 text-center text-sm text-muted-foreground">Nenhum corretor vinculado a esta equipe.</Card>
                ) : (
                  <>
                    {viewingPastDay && (
                      <div className={`rounded-md border p-2 text-xs flex items-start gap-2 ${readOnlyDay ? "border-warning/40 bg-warning/10" : "border-info/40 bg-info/10"}`}>
                        <AlertTriangle className={`h-4 w-4 shrink-0 mt-0.5 ${readOnlyDay ? "text-warning" : "text-info"}`} />
                        <div>
                          <p className={`font-bold ${readOnlyDay ? "text-warning" : "text-info"}`}>
                            {readOnlyDay
                              ? `Dia anterior aberto só para conferir: ${format(parseISO(date), "dd/MM/yyyy", { locale: ptBR })}`
                              : `Corrigindo o checkpoint de ${format(parseISO(date), "dd/MM/yyyy", { locale: ptBR })}`}
                          </p>
                          <p className="text-muted-foreground mt-0.5">
                            {filledDates.includes(date)
                              ? <>Preenchido por <b>{dayFilledBy || "gerente não informado"}</b>.</>
                              : "Nenhum checkpoint foi gravado neste dia."}
                          </p>
                          <p className="text-muted-foreground mt-0.5">
                            {readOnlyDay
                              ? <>Este link corrige o checkpoint de hoje e dos <b>{EDIT_WINDOW_DAYS} dias anteriores</b>; este dia é mais antigo, então o botão <b>Salvar</b> está desligado. Para mudá-lo, fale com a administração.</>
                              : <>Salvar grava <b>neste dia</b>, não em hoje ({format(today, "dd/MM", { locale: ptBR })}).</>}
                          </p>
                        </div>
                      </div>
                    )}
                    {!viewingPastDay && todayFilled && (
                      <div className="rounded-md border border-success/40 bg-success/10 p-2 text-xs flex items-center gap-2">
                        <Info className="h-4 w-4 text-success" />
                        Este dia já foi preenchido{dayFilledBy ? <> por <b>{dayFilledBy}</b></> : ""} — alterações vão sobrescrever o checkpoint.
                      </div>
                    )}
                    {emptyBrokers.length > 0 && (
                      <div className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                        <div>
                          <p className="font-bold text-warning">
                            {/* `emptyBrokers` sai de `activeRoster`; `roster`
                                inclui quem saiu e lançou no mês (0062). Com os
                                dois lados a tela dizia "5 de 8" e listava 5
                                nomes — os outros 3 pareciam lançamentos que
                                ninguém acha. A linha acima já conta ativos e
                                desligados separadamente. */}
                            {emptyBrokers.length} de {activeRoster.length} corretor{emptyBrokers.length === 1 ? "" : "es"} sem lançamentos
                          </p>
                          <p className="text-muted-foreground mt-0.5">{emptyBrokers.map((b) => b.broker_name).join(" • ")}</p>
                        </div>
                      </div>
                    )}
                    <Card className="border-primary/20 bg-card/60 backdrop-blur-xl overflow-hidden">

                      <div
                        className="hidden md:grid gap-2 px-3 py-2 border-b border-border/40 bg-secondary/30 text-xs uppercase font-bold tracking-wider text-muted-foreground md:[grid-template-columns:minmax(140px,1.4fr)_repeat(8,minmax(52px,1fr))_56px]"
                      >
                        <span>Corretor</span>
                        {FIELDS.map((f) => <span key={f.key} className={`text-center ${f.color}`}>{f.label}</span>)}
                        <span className="text-center">Total</span>
                      </div>
                      <div className="divide-y divide-border/30">
                        {roster.filter((b) => b.active !== false || showInactive).map((b) => {
                          const total = FIELDS.reduce((s, f) => s + (entries[b.broker_id]?.[f.key] || 0), 0);
                          const inactive = b.active === false;
                          const bm = brokerMonth[b.broker_id];
                          const isExp = !!expandedBroker[b.broker_id];
                          return (
                            <div key={b.broker_id} className={inactive ? "opacity-40 grayscale bg-muted/10" : "hover:bg-primary/5"}>
                            <div
                              className={`grid grid-cols-3 md:!grid gap-2 px-3 py-2 items-center transition md:[grid-template-columns:minmax(140px,1.4fr)_repeat(8,minmax(52px,1fr))_56px]`}
                              title={inactive ? "Corretor desligado — histórico preservado, sem novas inserções" : undefined}
                            >
                              <div className="flex items-center gap-2 col-span-3 md:col-span-1 min-w-0">
                                <div className="w-7 h-7 rounded-md bg-gradient-to-br from-primary/40 to-chart-5/30 flex items-center justify-center font-black text-xs border border-primary/40 shrink-0">
                                  {b.broker_name.charAt(0).toUpperCase()}
                                </div>
                                <span className="text-xs font-medium truncate flex-1">
                                  {b.broker_name}
                                  {inactive && <span className="ml-1 text-xs uppercase text-destructive">(desligado)</span>}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setExpandedBroker((p) => ({ ...p, [b.broker_id]: !p[b.broker_id] }))}
                                  className="text-xs px-1.5 py-0.5 rounded border border-primary/30 text-primary/90 hover:bg-primary/10 flex items-center gap-1 shrink-0"
                                  title="Mostrar/ocultar totais do mês"
                                  aria-label={`${isExp ? "Ocultar" : "Mostrar"} totais do mês de ${b.broker_name}`}
                                  aria-expanded={isExp}
                                >
                                  <BarChart3 className="h-3 w-3" />
                                  {isExp ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                </button>
                              </div>
                              {FIELDS.map((f) => {
                                const id = `daily-${b.broker_id}-${f.key}`;
                                const value = entries[b.broker_id]?.[f.key];
                                return (
                                <div key={f.key} className="flex flex-col md:block min-w-0">
                                  <label htmlFor={id} className={`md:hidden text-xs uppercase font-bold ${f.color} truncate`}>{f.label}</label>
                                  {/* Texto, não `type="number"`: num campo numérico o
                                      "0," intermediário chega vazio no `onChange` e o
                                      React reescreve o campo, então meio ponto era
                                      impossível de digitar. `parseBrl` lê vírgula e
                                      ponto; `commitField` normaliza ao sair. */}
                                  <Input
                                    id={id}
                                    type="text"
                                    inputMode="decimal"
                                    aria-label={`${f.label} — ${b.broker_name}`}
                                    disabled={inactive}
                                    // Dia fora da janela de correção: `readOnly`,
                                    // não `disabled` — "abre só para conferir"
                                    // pede que o número continue selecionável e
                                    // copiável. Sem isto o gerente digitava, os
                                    // funis e a barra de totais recalculavam ao
                                    // vivo e nada era gravável (o Salvar já está
                                    // desligado): o número na tela deixava de ser
                                    // o número do banco sem nenhum sinal. É o
                                    // mesmo tratamento da Textarea de
                                    // observações, logo abaixo.
                                    readOnly={readOnlyDay}
                                    value={draft[cellKey(b.broker_id, f.key)] ?? (value === undefined ? "" : num(value))}
                                    onChange={(e) => setField(b.broker_id, f.key, e.target.value)}
                                    onBlur={() => commitField(b.broker_id, f.key)}
                                    placeholder="0"
                                    className="h-8 w-full min-w-0 text-center text-xs font-bold px-1 placeholder:text-muted-foreground/40 disabled:cursor-not-allowed read-only:cursor-default read-only:opacity-70"
                                  />
                                </div>
                                );
                              })}
                              <Badge variant="outline" className="text-xs justify-center col-span-3 md:col-span-1">Total {num(total)}</Badge>
                            </div>
                            {isExp && (
                              <div className="px-3 pb-2 -mt-1">
                                <div className="rounded-md border border-primary/25 bg-primary/5 px-2 py-1.5">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-xs uppercase tracking-wider text-primary/80 font-bold flex items-center gap-1">
                                      <BarChart3 className="h-3 w-3" /> Totais do mês
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      {bm?.days_filled ? `${bm.days_filled} dia${bm.days_filled === 1 ? "" : "s"} preenchidos` : "sem lançamentos"}
                                    </span>
                                  </div>
                                  <div className="grid grid-cols-4 md:grid-cols-8 gap-1">
                                    {FIELDS.map((f) => (
                                      <div key={f.key} className="text-center px-1 py-1 rounded bg-background/40 border border-border/30">
                                        <p className={`text-xs uppercase ${f.color} truncate`}>{f.label}</p>
                                        <p className="text-sm font-black">{num(bm?.[f.key] ?? 0)}</p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            )}
                            </div>
                          );
                        })}
                        {roster.some((b) => b.active === false) && (
                          <div className="px-3 py-2 flex justify-center">
                            <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => setShowInactive((v) => !v)}>
                              {showInactive
                                ? "Ocultar corretores desligados"
                                : `Mostrar ${roster.filter((b) => b.active === false).length} corretor${roster.filter((b) => b.active === false).length === 1 ? "" : "es"} desligado${roster.filter((b) => b.active === false).length === 1 ? "" : "s"}`}
                            </Button>
                          </div>
                        )}
                      </div>

                    </Card>

                  </>
                )}

                <Card className="border-primary/20 bg-card/60 backdrop-blur-xl">
                  <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Flame className="h-4 w-4 text-warning" /> Observações do dia</CardTitle></CardHeader>
                  <CardContent>
                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      readOnly={readOnlyDay}
                      aria-label="Observações do dia"
                      placeholder={readOnlyDay ? "Sem observações neste dia." : "Contexto, dificuldades, vitórias..."}
                      rows={3}
                      className="text-xs"
                    />
                  </CardContent>
                </Card>

                {/* Funis compactos: dia + mês */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <CompactFunnel
                    title="Funil do dia — declarado"
                    subtitle={`metas: 100 → ${num(targets.analises)}% → ${num(targets.aprovados)}% → ${num(targets.vendas)}% · ${targetLabel}`}
                    steps={funnelSteps(totals)}
                  />
                  <CompactFunnel
                    title={monthCardTitle}
                    subtitle={monthCardSubtitle}
                    accent={tone("chart-5")}
                    steps={funnelSteps(monthTotals)}
                  />
                </div>


                {/* Totals + submit */}
                <Card className="border-primary/40 bg-gradient-to-r from-primary/10 via-chart-5/5 to-primary/10 backdrop-blur-xl sticky bottom-4 shadow-2xl shadow-primary/20">
                  <CardContent className="p-4 flex flex-col items-center gap-3">
                    <div className="grid grid-cols-4 md:grid-cols-8 gap-3 justify-items-center w-full max-w-2xl">
                      {FIELDS.map((f) => (
                        <div key={f.key} className="text-center min-w-0">
                          <p className="text-xs uppercase text-muted-foreground truncate">{f.label}</p>
                          <p className={`text-lg font-black ${f.color}`}>{num(totals[f.key])}</p>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-2 w-full">
                      <Button size="lg" variant="outline" onClick={() => setFormOpen(false)}>
                        Fechar
                      </Button>
                      <Button
                        size="lg"
                        onClick={submit}
                        disabled={submitting || roster.length === 0 || readOnlyDay}
                        title={readOnlyDay ? `Este link corrige até ${EDIT_WINDOW_DAYS} dias para trás` : undefined}
                        className="bg-gradient-to-r from-primary to-chart-5 hover:opacity-90"
                      >
                        {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                        Salvar Checkpoint
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}

          </>
        )}

        {xpBurst > 0 && (
          <div className="fixed inset-0 pointer-events-none flex items-center justify-center z-50">
            <div className="text-8xl font-black text-warning animate-scale-in drop-shadow-[0_0_40px_hsl(var(--highlight)/0.7)]">
              +{num(xpBurst)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
