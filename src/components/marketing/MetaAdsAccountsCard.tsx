import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { KeyRound, Loader2, Megaphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { LoadingState, SectionCard, StatusBadge, type StatusTone } from "@/components/shared";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { listIntegrations } from "@/integrations/supabase/integrations";
import { dateTime } from "@/lib/format";
import { functionErrorMessage } from "@/lib/functionError";
import { dbError, describeError } from "@/lib/supabaseError";

/**
 * Conta de anúncios da Marketing API, em /admin/meta-ads (F1.1).
 *
 * "Testar conexão" e "Salvar contas" passam pela edge `meta-ads-connect`, que
 * relista as contas na Meta e grava só as que o token alcança. A lista salva
 * sai de `meta_ad_accounts`, com o estado da conta e a última sincronização
 * boa. As duas ações exigem `settings.integrations` na edge e no banco
 * (`meta_accounts_save`); aqui os botões nascem desligados sem ela.
 */

/** A tabela entrou na 0115 e ainda não está no types.ts gerado (mesmo cast de analytics.ts). */
const untyped = supabase as unknown as SupabaseClient;

/** Chave só desta tela: o painel de alertas lê a mesma tabela com outras colunas,
 *  e um cache compartilhado trocaria o formato de uma tela pelo da outra. */
const CONTAS_KEY = ["marketing", "meta", "contas", "config"];

type EstadoConta = "rodando" | "saldo_baixo" | "sem_saldo" | "bloqueada" | "desconhecido";

type ContaSalva = {
  id: string;
  act_id: string;
  name: string | null;
  currency: string | null;
  enabled: boolean;
  balance_state: EstadoConta;
  account_checked_at: string | null;
  last_sync_attempt_at: string | null;
  last_sync_ok_at: string | null;
  last_sync_error: string | null;
};

type ContaAlcancada = {
  act_id: string;
  name: string | null;
  currency: string | null;
  timezone_name: string | null;
  account_status: number | null;
};

type Teste = { ok: true; usuario: { id: string | null; name: string | null }; contas: ContaAlcancada[] };
type Salvo = { ok: true; salvas: number };

const ESTADO: Record<EstadoConta, { tone: StatusTone; texto: string }> = {
  rodando: { tone: "success", texto: "Rodando" },
  saldo_baixo: { tone: "warning", texto: "Saldo baixo" },
  sem_saldo: { tone: "danger", texto: "Sem saldo" },
  bloqueada: { tone: "danger", texto: "Bloqueada" },
  desconhecido: { tone: "neutral", texto: "Estado ainda não lido" },
};

/** `account_status` da Meta (Ad Account reference). */
const STATUS_META: Record<number, string> = {
  1: "ativa",
  2: "desativada",
  3: "pagamento pendente",
  7: "em revisão pela Meta",
  8: "acerto pendente",
  9: "em período de tolerância",
  100: "encerrando",
  101: "encerrada",
};

async function lerContas(): Promise<ContaSalva[]> {
  const { data, error } = await untyped
    .from("meta_ad_accounts")
    .select(
      "id, act_id, name, currency, enabled, balance_state, account_checked_at, last_sync_attempt_at, last_sync_ok_at, last_sync_error",
    )
    .order("name");
  if (error) throw dbError("listar contas de anúncios", error);
  return (data ?? []) as ContaSalva[];
}

/** Falha da edge com o status HTTP: o 409 (sem token) tem bloco próprio na tela. */
class FalhaConexao extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
  }
}

async function conectar<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>("meta-ads-connect", { body });
  if (error) {
    const status = (error as { context?: Response }).context?.status ?? null;
    throw new FalhaConexao(await functionErrorMessage(error, "Não foi possível falar com a Meta."), status);
  }
  if (!data) throw new FalhaConexao("A conexão respondeu sem conteúdo.", null);
  return data;
}

function ContaSalvaLinha({ conta: c }: { conta: ContaSalva }) {
  const estado = ESTADO[c.balance_state] ?? ESTADO.desconhecido;
  return (
    <li className="space-y-1 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium">{c.name ?? c.act_id}</p>
          <p className="text-xs text-muted-foreground">
            {c.act_id}
            {c.currency ? ` · ${c.currency}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone={c.enabled ? "success" : "neutral"}>{c.enabled ? "Ligada" : "Desligada"}</StatusBadge>
          <StatusBadge tone={estado.tone}>{estado.texto}</StatusBadge>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {c.last_sync_ok_at
          ? `Última sincronização boa: ${dateTime(c.last_sync_ok_at)}`
          : "Ainda não houve sincronização boa."}
        {c.account_checked_at && ` · estado verificado em ${dateTime(c.account_checked_at)}`}
      </p>
      {/* Falha aparece como falha: os números da tela continuam os da última boa. */}
      {c.last_sync_error && (
        <p className="text-xs text-destructive">
          A última sincronização falhou{c.last_sync_attempt_at ? ` em ${dateTime(c.last_sync_attempt_at)}` : ""}:{" "}
          {c.last_sync_error}
        </p>
      )}
    </li>
  );
}

export function MetaAdsAccountsCard() {
  const { can } = useAuth();
  const podeGravar = can("settings.integrations");
  const queryClient = useQueryClient();
  const baseId = useId();
  const contas = useQuery({ queryKey: CONTAS_KEY, queryFn: lerContas });
  // Mesma chave e mesma leitura da página: o cache é um só, sem pedido a mais.
  const cofre = useQuery({ queryKey: ["integrations"], queryFn: listIntegrations, enabled: podeGravar });
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());

  const testar = useMutation({
    mutationFn: () => conectar<Teste>({ action: "testar" }),
    onSuccess: (r) => {
      // Começa marcado o que já está ligado e o token ainda alcança.
      const ligadas = new Set((contas.data ?? []).filter((c) => c.enabled).map((c) => c.act_id));
      setMarcadas(new Set(r.contas.filter((c) => ligadas.has(c.act_id)).map((c) => c.act_id)));
    },
  });

  const salvar = useMutation({
    mutationFn: (actIds: string[]) => conectar<Salvo>({ action: "salvar", act_ids: actIds }),
    onSuccess: async (r, actIds) => {
      const ligadas = r.salvas === 1 ? "1 conta ligada" : `${r.salvas} contas ligadas`;
      const foraDoAlcance = actIds.length - r.salvas;
      // Marcada que o token não alcança não foi salva: resultado parcial, sem o som de sucesso.
      if (foraDoAlcance > 0) {
        toast.warning("Contas salvas em parte", {
          description: `${ligadas}; ${foraDoAlcance} das marcadas o token não alcança mais e ficaram de fora.`,
        });
      } else {
        toast.success("Contas salvas", {
          description: r.salvas === 0
            ? "Nenhuma conta ligada: a sincronização com a Meta fica parada."
            : `${ligadas}. As desmarcadas saem da sincronização; o histórico fica.`,
        });
      }
      await queryClient.invalidateQueries({ queryKey: ["marketing"] });
    },
    onError: (e) => toast.error("Não foi possível salvar as contas", { description: e.message }),
  });

  const alternar = (act: string, ligar: boolean) =>
    setMarcadas((atual) => {
      const nova = new Set(atual);
      if (ligar) nova.add(act);
      else nova.delete(act);
      return nova;
    });

  const tokenNoCofre = cofre.data?.some(
    (r) => r.provider === "meta" && r.label === "marketing_access_token" && r.has_secret,
  );
  const semTokenNaEdge = testar.error instanceof FalhaConexao && testar.error.status === 409;
  // O cofre vazio avisa antes do teste, mas não trava o botão: a edge também lê
  // o secret de ambiente, e é ela quem responde 409 quando não há token nenhum.
  const semToken = semTokenNaEdge || (!testar.data && tokenNoCofre === false);
  const teste = testar.data;

  return (
    <SectionCard
      title="Conta de anúncios (Marketing API)"
      icon={Megaphone}
      description="Teste o token e escolha as contas que o sistema sincroniza."
      actions={
        <Button size="sm" variant="outline" disabled={!podeGravar || testar.isPending} onClick={() => testar.mutate()}>
          {testar.isPending ? <><Loader2 className="animate-spin" aria-hidden /> Testando…</> : "Testar conexão"}
        </Button>
      }
    >
      <div className="space-y-5">
        {!podeGravar && (
          <p role="status" className="text-xs text-warning">
            Sem a permissão &quot;Gerenciar integrações&quot;: dá para ver as contas salvas, não para testar a conexão
            nem salvar.
          </p>
        )}

        {semToken && (
          <div role="status" className="rounded-2xl border border-warning/25 bg-warning/10 px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-warning">
              <KeyRound className="h-4 w-4 shrink-0" aria-hidden /> Token não cadastrado
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              O token da Marketing API não está no cofre, e sem ele nada liga: sem teste, sem contas e sem
              sincronização. Gere no Business Manager um token de usuário de sistema com ads_read e ads_management,
              cole no campo &quot;Meta — token da Marketing API&quot;, em Credenciais da Meta no cofre (logo acima), e
              clique em Testar conexão.
            </p>
          </div>
        )}

        {testar.error && !semTokenNaEdge && (
          <p role="status" className="text-sm text-destructive">{testar.error.message}</p>
        )}

        {teste && (
          <div className="space-y-3">
            <p role="status" className="text-sm">
              Token de <b>{teste.usuario.name ?? "usuário sem nome"}</b>: alcança {teste.contas.length}{" "}
              {teste.contas.length === 1 ? "conta" : "contas"} de anúncios.
            </p>
            {teste.contas.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No Business Manager, dê ao usuário de sistema acesso à conta de anúncios e teste de novo.
              </p>
            ) : (
              <fieldset>
                <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Contas que o sistema sincroniza
                </legend>
                <ul className="mt-2 divide-y divide-border">
                  {teste.contas.map((c) => {
                    const id = `${baseId}-${c.act_id}`;
                    return (
                      <li key={c.act_id} className="flex items-start gap-3 py-2">
                        <Checkbox
                          id={id}
                          className="mt-0.5"
                          checked={marcadas.has(c.act_id)}
                          disabled={!podeGravar || salvar.isPending}
                          onCheckedChange={(v) => alternar(c.act_id, v === true)}
                        />
                        <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                          <span className="block text-sm font-medium">{c.name ?? c.act_id}</span>
                          <span className="block text-xs text-muted-foreground">
                            {[
                              c.act_id,
                              c.currency,
                              c.timezone_name,
                              c.account_status === null
                                ? null
                                : STATUS_META[c.account_status] ?? `status ${c.account_status}`,
                            ].filter(Boolean).join(" · ")}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={!podeGravar || !teste || salvar.isPending}
            onClick={() => salvar.mutate([...marcadas])}
          >
            {salvar.isPending ? <><Loader2 className="animate-spin" aria-hidden /> Salvando…</> : "Salvar contas"}
          </Button>
          <span className="text-xs text-muted-foreground">
            {teste
              ? "Conta desmarcada sai da sincronização; o histórico fica."
              : "Teste a conexão para escolher as contas."}
          </span>
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Contas salvas</h3>
          {contas.isPending ? (
            <LoadingState variant="list" rows={2} label="Carregando contas salvas…" />
          ) : contas.isError ? (
            <p role="status" className="text-sm text-destructive">
              {describeError(contas.error, "Não consegui ler as contas salvas.")}
            </p>
          ) : contas.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma conta salva. Sem conta ligada, nada sincroniza.</p>
          ) : (
            <ul className="divide-y divide-border">
              {contas.data.map((c) => <ContaSalvaLinha key={c.id} conta={c} />)}
            </ul>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
