import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { History } from "lucide-react";
import { LoadingState, SectionCard, StatusBadge, type StatusTone } from "@/components/shared";
import { supabase } from "@/integrations/supabase/client";
import { brl, dateTime } from "@/lib/format";
import { dbError, describeError } from "@/lib/supabaseError";

/**
 * Histórico das ações na Meta: quem fez o quê, quando, de quanto para quanto e
 * o que a Meta respondeu (F1.3). Manual e fila do gestor IA saem da mesma
 * tabela, `meta_actions`, que só as RPCs do executor gravam — aqui é só leitura
 * (RLS por reports.view_finance). A proposta ainda na fila fica na tela do
 * gestor; aqui entra o que já foi decidido.
 */

/** A tabela entrou na 0116 e ainda não está no types.ts gerado (mesmo cast de analytics.ts). */
const untyped = supabase as unknown as SupabaseClient;

type Conjunto = { id: string; nome: string | null; de: number; para: number; ok: boolean; erro?: string };
type Resultado = {
  antes?: { status?: string | null; verba_diaria?: number | null };
  depois?: { status?: string; verba_diaria?: number };
  conjuntos?: Conjunto[];
};

type LinhaAcao = {
  id: string;
  created_at: string;
  decided_at: string | null;
  executed_at: string | null;
  campaign_name: string | null;
  campaign_external_id: string;
  origem: "manual" | "ia";
  acao: "pausar" | "ativar" | "verba";
  verba_anterior: number | null;
  verba_nova: number | null;
  status: string;
  requested_by: string | null;
  decided_by: string | null;
  motivo: string | null;
  resultado: Resultado | null;
  erro: string | null;
};

type Historico = { linhas: LinhaAcao[]; nomes: Record<string, string> };

const ESTADO: Record<string, { tone: StatusTone; texto: string }> = {
  executada: { tone: "success", texto: "Feito na Meta" },
  parcial: { tone: "warning", texto: "Feito em parte" },
  falhou: { tone: "danger", texto: "Falhou" },
  recusada: { tone: "neutral", texto: "Recusada" },
  expirada: { tone: "neutral", texto: "Venceu sem decisão" },
  aprovada: { tone: "info", texto: "Aguardando execução" },
  executando: { tone: "info", texto: "Em execução" },
};

const STATUS_META: Record<string, string> = { ACTIVE: "ativa", PAUSED: "pausada" };
const reais = (v: number | null | undefined) => brl(v, { cents: true });

async function lerHistorico(): Promise<Historico> {
  const { data, error } = await untyped
    .from("meta_actions")
    .select(
      "id, created_at, decided_at, executed_at, campaign_name, campaign_external_id, origem, acao, verba_anterior, verba_nova, status, requested_by, decided_by, motivo, resultado, erro",
    )
    .neq("status", "proposta")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw dbError("ler o histórico de ações na Meta", error);
  const linhas = (data ?? []) as LinhaAcao[];

  // Nome é apoio, não é o registro: profiles_select só mostra ao marketing o
  // próprio perfil, e esta view (0120) expõe só id e nome de admin, sócio,
  // marketing e sdr. Se ela falhar, a linha continua certa, sem o nome.
  const ids = [...new Set(linhas.flatMap((l) => [l.requested_by, l.decided_by]).filter((id): id is string => !!id))];
  const nomes: Record<string, string> = {};
  if (ids.length > 0) {
    const { data: pessoas } = await untyped.from("sdr_operator_names").select("id, full_name").in("id", ids);
    for (const p of (pessoas ?? []) as { id: string; full_name: string | null }[]) {
      if (p.full_name) nomes[p.id] = p.full_name;
    }
  }
  return { linhas, nomes };
}

function oQue(l: LinhaAcao): string {
  if (l.acao !== "verba") {
    const antes = l.resultado?.antes?.status;
    const verbo = l.acao === "pausar" ? "Pausar" : "Ativar";
    return antes ? `${verbo} (estava ${STATUS_META[antes] ?? antes.toLowerCase()} na Meta)` : verbo;
  }
  // O "antes" lido na Meta na hora da execução vale mais que o do banco, que pode ter um dia de atraso.
  const antes = l.resultado?.antes?.verba_diaria ?? l.verba_anterior;
  return antes != null
    ? `Verba diária de ${reais(antes)} para ${reais(l.verba_nova)}`
    : `Verba diária para ${reais(l.verba_nova)}`;
}

function quem(l: LinhaAcao, nomes: Record<string, string>): string {
  const nome = (id: string | null) => (id ? nomes[id] ?? "pessoa sem nome visível" : "—");
  if (l.origem === "manual") return `por ${nome(l.requested_by)}`;
  if (l.status === "expirada") return "proposta do gestor IA · venceu sem decisão";
  if (l.status === "recusada") return `proposta do gestor IA · recusada por ${nome(l.decided_by)}`;
  return `proposta do gestor IA · aprovada por ${nome(l.decided_by)}`;
}

function Linha({ l, nomes }: { l: LinhaAcao; nomes: Record<string, string> }) {
  const estado = ESTADO[l.status] ?? { tone: "neutral" as StatusTone, texto: l.status };
  const conjuntos = l.resultado?.conjuntos ?? [];
  return (
    <li className="space-y-1 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium">{l.campaign_name ?? l.campaign_external_id}</p>
          <p className="text-sm">{oQue(l)}</p>
          <p className="text-xs text-muted-foreground">
            {dateTime(l.executed_at ?? l.decided_at ?? l.created_at)} · {quem(l, nomes)}
          </p>
        </div>
        <StatusBadge tone={estado.tone} className="self-start">{estado.texto}</StatusBadge>
      </div>
      {l.origem === "ia" && l.motivo && (
        <p className="text-xs text-muted-foreground">Motivo do gestor IA: {l.motivo}</p>
      )}
      {conjuntos.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {conjuntos.map((c) => (
            <li key={c.id}>
              {c.nome ?? `Conjunto ${c.id}`}: {reais(c.de)} → {reais(c.para)}
              {c.ok ? "" : <span className="text-destructive"> · recusado: {c.erro ?? "sem motivo"}</span>}
            </li>
          ))}
        </ul>
      )}
      {l.erro && (l.status === "falhou" || l.status === "parcial") && (
        <p className="text-xs text-destructive">{l.erro}</p>
      )}
    </li>
  );
}

export function MetaActionsLog() {
  const historico = useQuery({ queryKey: ["marketing", "meta", "acoes"], queryFn: lerHistorico });

  return (
    <SectionCard
      title="Ações na Meta"
      icon={History}
      description="Quem pausou, ativou ou mudou verba, quando, de quanto para quanto e o que a Meta respondeu. As 50 mais recentes."
    >
      {historico.isPending ? (
        <LoadingState variant="list" rows={3} label="Carregando o histórico de ações…" />
      ) : historico.isError ? (
        <p role="status" className="text-sm text-destructive">
          {describeError(historico.error, "Não consegui ler o histórico de ações na Meta.")}
        </p>
      ) : historico.data.linhas.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma ação na Meta ainda. Pausar, ativar e mudar verba pelo CRM aparecem aqui, com o resultado.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {historico.data.linhas.map((l) => <Linha key={l.id} l={l} nomes={historico.data.nomes} />)}
        </ul>
      )}
    </SectionCard>
  );
}
