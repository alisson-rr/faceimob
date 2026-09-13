import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BellRing, Gauge, History, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingState, SectionCard, StatusBadge, type StatusTone } from "@/components/shared";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { brl, dateTime, parseBrl } from "@/lib/format";
import { dbError, describeError } from "@/lib/supabaseError";

/**
 * Aba Alertas de /marketing (F1.5 e F1.6).
 *
 * O estado de cada conta e os alertas são decididos no banco
 * (`meta_avaliar_alertas`, 0117) depois de cada sincronização; aqui só se lê e
 * se mudam os limites. Gravar exige `marketing.meta_manage` no banco
 * (`meta_account_thresholds_set`); a tela repete a trava para o botão não
 * prometer o que o banco recusa.
 */

/** As colunas entraram na 0115/0116 e ainda não estão no types.ts gerado (mesmo cast de analytics.ts). */
const untyped = supabase as unknown as SupabaseClient;

/** Chave própria: o card de /admin/meta-ads lê a mesma tabela com outras colunas,
 *  e um cache compartilhado trocaria o formato de uma tela pelo da outra. */
const CONTAS_KEY = ["marketing", "meta", "contas", "limites"];
const ALERTAS_KEY = ["marketing", "meta", "alertas"];
const RESOLVIDOS_DIAS = 30;

type EstadoConta = "rodando" | "saldo_baixo" | "sem_saldo" | "bloqueada" | "desconhecido";

type Conta = {
  id: string;
  act_id: string;
  name: string | null;
  enabled: boolean;
  balance_state: EstadoConta;
  account_checked_at: string | null;
  last_sync_attempt_at: string | null;
  last_sync_ok_at: string | null;
  last_sync_error: string | null;
  cpl_limite: number | null;
  gasto_sem_lead_limite: number | null;
  gasto_sem_lead_dias: number | null;
  verba_mensal: number | null;
  verba_aviso_pct: number | null;
  saldo_baixo_limite: number | null;
};

type Alerta = {
  id: string;
  account_id: string;
  mensagem: string;
  opened_at: string;
  resolved_at: string | null;
};

const ESTADO: Record<EstadoConta, { tone: StatusTone; texto: string }> = {
  rodando: { tone: "success", texto: "Rodando" },
  saldo_baixo: { tone: "warning", texto: "Saldo baixo" },
  sem_saldo: { tone: "danger", texto: "Sem saldo" },
  bloqueada: { tone: "danger", texto: "Bloqueada" },
  desconhecido: { tone: "neutral", texto: "Ainda não verificado" },
};

type Campos = { cpl: string; gasto: string; dias: string; verba: string; pct: string; saldo: string };

/** Rótulos iguais aos do aviso: o custo por resultado é o da Meta, não o CPL do CRM. */
const CAMPOS: { chave: keyof Campos; rotulo: string; dica: string; inteiro?: true }[] = [
  {
    chave: "cpl",
    rotulo: "Custo por resultado (segundo a Meta) acima do limite (R$)",
    dica: "Últimos 7 dias, no canal da campanha. Não é o CPL do CRM. Vazio desliga.",
  },
  { chave: "gasto", rotulo: "Gasto sem lead: a partir de (R$)", dica: "Sem lead no CRM e sem resultado na Meta. Vazio desliga." },
  { chave: "dias", rotulo: "Gasto sem lead: janela (dias)", dica: "De 1 a 30 dias.", inteiro: true },
  { chave: "verba", rotulo: "Verba do mês (R$)", dica: "Comparada com o gasto do mês segundo a Meta. Vazio desliga." },
  { chave: "pct", rotulo: "Verba do mês: avisar em (%)", dica: "De 50 a 100; avisa de novo em 100%.", inteiro: true },
  {
    chave: "saldo",
    rotulo: "Saldo baixo: abaixo de (R$)",
    dica: "Limite de gastos restante ou saldo pré-pago. Vazio: só pelo status da Meta.",
  },
];

const rotulo = (chave: keyof Campos) => CAMPOS.find((c) => c.chave === chave)?.rotulo ?? chave;

async function lerContas(): Promise<Conta[]> {
  const { data, error } = await untyped
    .from("meta_ad_accounts")
    .select(
      "id, act_id, name, enabled, balance_state, account_checked_at, last_sync_attempt_at, last_sync_ok_at, last_sync_error, cpl_limite, gasto_sem_lead_limite, gasto_sem_lead_dias, verba_mensal, verba_aviso_pct, saldo_baixo_limite",
    )
    .order("name");
  if (error) throw dbError("listar as contas de anúncios", error);
  return (data ?? []) as Conta[];
}

/** Abertos (todos) e resolvidos dos últimos dias. */
async function lerAlertas(): Promise<Alerta[]> {
  const desde = new Date(Date.now() - RESOLVIDOS_DIAS * 86_400_000).toISOString();
  const { data, error } = await untyped
    .from("meta_alerts")
    .select("id, account_id, mensagem, opened_at, resolved_at")
    .or(`resolved_at.is.null,resolved_at.gte."${desde}"`)
    .order("opened_at", { ascending: false })
    .limit(200);
  if (error) throw dbError("listar os alertas da Meta", error);
  return (data ?? []) as Alerta[];
}

/** Dinheiro: vazio desliga o alerta; texto que não é valor não passa. */
function reais(texto: string, chave: keyof Campos): number | null {
  if (!texto.trim()) return null;
  const valor = parseBrl(texto);
  if (valor === null || valor < 0) throw new Error(`${rotulo(chave)}: valor inválido.`);
  return valor;
}

function inteiro(texto: string, chave: keyof Campos, min: number, max: number): number {
  const valor = Number(texto.trim());
  if (!texto.trim() || !Number.isInteger(valor) || valor < min || valor > max) {
    throw new Error(`${rotulo(chave)}: use um número inteiro de ${min} a ${max}.`);
  }
  return valor;
}

const campoReais = (valor: number | null) => (valor === null ? "" : brl(valor, { cents: true }));

function LimitesForm({ conta, podeGravar }: { conta: Conta; podeGravar: boolean }) {
  const id = useId();
  const queryClient = useQueryClient();
  const [campos, setCampos] = useState<Campos>(() => ({
    cpl: campoReais(conta.cpl_limite),
    gasto: campoReais(conta.gasto_sem_lead_limite),
    dias: String(conta.gasto_sem_lead_dias ?? 3),
    verba: campoReais(conta.verba_mensal),
    pct: String(conta.verba_aviso_pct ?? 85),
    saldo: campoReais(conta.saldo_baixo_limite),
  }));

  const salvar = useMutation({
    mutationFn: async () => {
      const { error } = await untyped.rpc("meta_account_thresholds_set", {
        p_account_id: conta.id,
        p_cpl_limite: reais(campos.cpl, "cpl"),
        p_gasto_sem_lead_limite: reais(campos.gasto, "gasto"),
        p_gasto_sem_lead_dias: inteiro(campos.dias, "dias", 1, 30),
        p_verba_mensal: reais(campos.verba, "verba"),
        p_verba_aviso_pct: inteiro(campos.pct, "pct", 50, 100),
        p_saldo_baixo_limite: reais(campos.saldo, "saldo"),
      });
      if (error) throw dbError("salvar os limites dos alertas", error);
    },
    onSuccess: async () => {
      toast.success("Limites dos alertas salvos", { description: "Os alertas desta conta já foram reavaliados com eles." });
      await queryClient.invalidateQueries({ queryKey: ["marketing", "meta"] });
    },
    // Validação de campo é Error nosso, já em pt-BR; o do banco (`dbError`) não pode sair cru.
    // Exceção: 22023 aqui só sai dos `raise` da própria RPC (0117), em pt-BR, e é o
    // motivo real ("Conta de anúncios não encontrada.").
    onError: (e) => {
      const db = (e as { db?: { code?: string; message?: string } }).db;
      toast.error("Não foi possível salvar os limites", {
        description:
          db?.code === "22023" && db.message
            ? db.message
            : describeError(e, db ? "Confira os valores e tente de novo." : e.message),
      });
    },
  });

  const bloqueado = !podeGravar || salvar.isPending;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        salvar.mutate();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CAMPOS.map((c) => {
          const campoId = `${id}-${c.chave}`;
          return (
            <div key={c.chave} className="space-y-1.5">
              <Label htmlFor={campoId}>{c.rotulo}</Label>
              <Input
                id={campoId}
                inputMode={c.inteiro ? "numeric" : "decimal"}
                value={campos[c.chave]}
                disabled={bloqueado}
                aria-describedby={`${campoId}-dica`}
                onChange={(e) => {
                  const valor = e.target.value;
                  setCampos((atual) => ({ ...atual, [c.chave]: valor }));
                }}
              />
              <p id={`${campoId}-dica`} className="text-xs text-muted-foreground">{c.dica}</p>
            </div>
          );
        })}
      </div>
      <Button type="submit" size="sm" disabled={bloqueado}>
        {salvar.isPending ? <><Loader2 className="animate-spin" aria-hidden /> Salvando…</> : "Salvar limites"}
      </Button>
    </form>
  );
}

function ContaBloco({ conta, podeGravar }: { conta: Conta; podeGravar: boolean }) {
  const estado = ESTADO[conta.balance_state] ?? ESTADO.desconhecido;
  return (
    <li className="space-y-4 py-5 first:pt-0 last:pb-0">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{conta.name ?? conta.act_id}</h3>
          <StatusBadge tone={estado.tone}>{estado.texto}</StatusBadge>
          {!conta.enabled && <StatusBadge tone="neutral">Desligada</StatusBadge>}
        </div>
        <p className="text-xs text-muted-foreground">
          {conta.account_checked_at
            ? `Estado verificado em ${dateTime(conta.account_checked_at)}.`
            : "A conta ainda não foi lida na Meta: o estado aparece depois da primeira sincronização."}
        </p>
        {/* Falha aparece como falha: estado e alertas continuam os da última leitura boa. */}
        {conta.last_sync_error && (
          <p className="text-xs text-destructive">
            A última sincronização falhou
            {conta.last_sync_attempt_at ? ` em ${dateTime(conta.last_sync_attempt_at)}` : ""}: {conta.last_sync_error}
            {" · "}
            {conta.last_sync_ok_at
              ? `estado e alertas são da última sincronização boa, em ${dateTime(conta.last_sync_ok_at)}.`
              : "ainda não houve sincronização boa."}
          </p>
        )}
      </div>
      <LimitesForm conta={conta} podeGravar={podeGravar} />
    </li>
  );
}

function ListaAlertas({ alertas, nomeDaConta }: { alertas: Alerta[]; nomeDaConta: Map<string, string> }) {
  return (
    <ul className="divide-y divide-border">
      {alertas.map((a) => (
        <li key={a.id} className="space-y-1 py-3 first:pt-0 last:pb-0">
          <p className="text-sm">{a.mensagem}</p>
          <p className="text-xs text-muted-foreground">
            {nomeDaConta.get(a.account_id) ?? "Conta de anúncios"} · aberto em {dateTime(a.opened_at)}
            {a.resolved_at && ` · resolvido em ${dateTime(a.resolved_at)}`}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function MetaAlertsPanel() {
  const { can } = useAuth();
  const podeGravar = can("marketing.meta_manage");
  const contas = useQuery({ queryKey: CONTAS_KEY, queryFn: lerContas });
  const alertas = useQuery({ queryKey: ALERTAS_KEY, queryFn: lerAlertas });

  const nomeDaConta = new Map((contas.data ?? []).map((c) => [c.id, c.name ?? c.act_id]));
  const abertos = (alertas.data ?? []).filter((a) => !a.resolved_at);
  const resolvidos = (alertas.data ?? []).filter((a) => a.resolved_at);

  const alertasOu = (lista: Alerta[], vazio: string) =>
    alertas.isPending ? (
      <LoadingState variant="list" rows={2} label="Carregando alertas…" />
    ) : alertas.isError ? (
      <p role="status" className="text-sm text-destructive">
        {describeError(alertas.error, "Não consegui ler os alertas.")}
      </p>
    ) : lista.length === 0 ? (
      <p className="text-sm text-muted-foreground">{vazio}</p>
    ) : (
      <ListaAlertas alertas={lista} nomeDaConta={nomeDaConta} />
    );

  return (
    <div className="space-y-6">
      <SectionCard
        title="Alertas abertos"
        icon={BellRing}
        description="Cada alerta avisa uma vez, no sino e no WhatsApp de administrador, sócio e marketing, e fecha sozinho quando a condição some."
      >
        {alertasOu(abertos, "Nenhum alerta aberto.")}
      </SectionCard>

      <SectionCard
        title="Estado das contas e limites dos alertas"
        icon={Gauge}
        description="O estado é lido na Meta a cada sincronização e avisa só quando muda. Os limites valem por conta."
      >
        <div className="space-y-4">
          {!podeGravar && (
            <p role="status" className="text-xs text-warning">
              Sem a permissão &quot;Gerenciar campanhas na Meta&quot;: dá para ver o estado e os limites, não para
              mudar.
            </p>
          )}
          {contas.isPending ? (
            <LoadingState variant="list" rows={2} label="Carregando contas…" />
          ) : contas.isError ? (
            <p role="status" className="text-sm text-destructive">
              {describeError(contas.error, "Não consegui ler as contas de anúncios.")}
            </p>
          ) : contas.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma conta de anúncios salva. O administrador escolhe as contas em Admin · Meta Ads.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {contas.data.map((c) => <ContaBloco key={c.id} conta={c} podeGravar={podeGravar} />)}
            </ul>
          )}
        </div>
      </SectionCard>

      <SectionCard title={`Resolvidos nos últimos ${RESOLVIDOS_DIAS} dias`} icon={History}>
        {alertasOu(resolvidos, `Nenhum alerta resolvido nos últimos ${RESOLVIDOS_DIAS} dias.`)}
      </SectionCard>
    </div>
  );
}
