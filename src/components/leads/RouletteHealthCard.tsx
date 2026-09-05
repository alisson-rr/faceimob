import {
  AlertTriangle, ListOrdered, Loader2, PauseCircle, RadioTower, RefreshCcw, Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionCard, StatusBadge } from "@/components/shared";
import { dateTime, num } from "@/lib/format";
import { describeError } from "@/lib/supabaseError";
import { isLeadUnattended, type GroupQueue, type LeadRecord } from "@/integrations/supabase/leads";

/**
 * Saúde da roleta — a resposta a "por que fulano não recebeu lead?".
 *
 * `distribution_queue` é a única fonte de "quem está pronto para receber": ela
 * junta presença aberta, turno já distribuindo, perfil ativo e o bloqueio por
 * leads atrasados. Quando ela vem vazia e há lead na fila, a roleta está parada
 * — e até aqui nenhuma tela dizia isso a ninguém: os leads ficavam em `queued`
 * indefinidamente e o gestor só descobria pela reclamação do cliente.
 *
 * Só aparece para quem tem `leads.view_queue` (gerente, diretor, marketing,
 * admin): é o mesmo predicado que a RPC e a policy `leads_select` exigem, então
 * quem vê o card enxerga dados de verdade, não zeros por RLS.
 */
export function RouletteHealthCard({
  queues, queuedLeads, isPending, error, onRetry, onOpenLead, onDistribute, distributingId,
  paused = false, maxRounds = 5,
}: {
  queues: GroupQueue[];
  /** Leads em `queued` que o usuário enxerga — os que esperam a roleta. */
  queuedLeads: LeadRecord[];
  isPending: boolean;
  error: unknown;
  onRetry: () => void;
  onOpenLead: (lead: LeadRecord) => void;
  /** Empurra o lead para a roleta sem escolher corretor (`distribute_queued_lead`). */
  onDistribute: (lead: LeadRecord) => void;
  distributingId: string | null;
  /**
   * `automation_settings.leads_paused`. Com a pausa ligada, `assign_lead`
   * devolve null antes de olhar a fila: o card mostrava "N pronto(s)" e o botão
   * dizia que ninguém podia receber, mandando o gestor procurar check-in.
   */
  paused?: boolean;
  /**
   * `automation_settings.roulette_max_rounds`. Estourado o teto, `assign_lead`
   * para de oferecer o lead: ele deixa de ser "esperando a roleta" e passa a
   * ser "esperando gente" — a bandeja abaixo.
   */
  maxRounds?: number;
}) {
  const prontos = new Set(
    queues.flatMap((queue) => queue.entries.map((entry) => entry.profile_id)),
  );
  const parada = prontos.size === 0;
  // Duas listas, porque são dois problemas diferentes: um espera a roleta
  // girar, o outro já girou o máximo e ninguém atendeu.
  const semAtendimento = queuedLeads.filter((lead) => isLeadUnattended(lead, maxRounds));
  const esperando = queuedLeads.filter((lead) => !isLeadUnattended(lead, maxRounds));
  const maisAntigo = esperando.reduce<LeadRecord | null>(
    (oldest, lead) => (!oldest || lead.created_at < oldest.created_at ? lead : oldest),
    null,
  );

  return (
    <SectionCard
      title="Saúde da roleta"
      description="Quem está pronto para receber lead agora, por grupo de distribuição."
      icon={RadioTower}
      actions={
        <StatusBadge tone={paused ? "warning" : parada ? (queuedLeads.length ? "danger" : "warning") : "success"}>
          {paused ? "Distribuição pausada" : parada ? "Ninguém na fila" : `${num(prontos.size)} pronto(s)`}
        </StatusBadge>
      }
      contentClassName="space-y-3"
    >
      {error ? (
        <p className="flex flex-wrap items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          {describeError(error, "não foi possível ler as filas de distribuição")}
          <Button variant="outline" size="sm" className="h-7" onClick={onRetry}>Tentar de novo</Button>
        </p>
      ) : isPending ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Consultando as filas…
        </p>
      ) : (
        <>
          {paused && (
            <p className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
              <PauseCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                A distribuição está pausada em <strong>Admin · Automação de Leads</strong> — nenhum lead
                sai da fila até religar, mesmo com corretor em check-in.
              </span>
            </p>
          )}

          {!paused && parada && esperando.length > 0 && (
            <p className="rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              A roleta está parada: ninguém com check-in aberto dentro do horário de distribuição.
              {" "}<strong>{num(esperando.length)} lead(s)</strong> ficam esperando até alguém bater ponto
              {maisAntigo ? ` — o mais antigo chegou em ${dateTime(maisAntigo.created_at)}.` : "."}
            </p>
          )}

          {queues.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum grupo de distribuição ativo.</p>
          )}

          {queues.map((queue) => (
            <div key={queue.groupId} className="rounded-xl border border-border bg-muted/30 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <ListOrdered className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                <span className="text-sm font-semibold">{queue.groupName}</span>
                <StatusBadge tone={queue.entries.length ? "info" : "neutral"}>
                  {queue.entries.length ? `${num(queue.entries.length)} na fila` : "fila vazia"}
                </StatusBadge>
              </div>
              {queue.error ? (
                <p className="mt-1.5 text-xs text-destructive">
                  {describeError(queue.error, "sem permissão para ver esta fila")}
                </p>
              ) : queue.entries.length === 0 ? (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Ninguém elegível: sem check-in aberto, fora do horário de distribuição do turno, ou
                  bloqueado por leads atrasados.
                </p>
              ) : (
                <ol className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                  {queue.entries.map((entry) => (
                    <li
                      key={entry.profile_id}
                      className="flex items-center gap-2 rounded-lg bg-secondary/40 px-2 py-1 text-xs"
                    >
                      <StatusBadge tone="neutral">{entry.queue_position}º</StatusBadge>
                      <span className="truncate">{entry.full_name}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ))}

          {/* Bandeja "sem atendimento": o lead rodou o teto de voltas e saiu da
              distribuição automática. Antes ele ficava em `queued` misturado
              com os que acabaram de chegar e ninguém era avisado — só aparecia
              para quem abrisse este card e soubesse o que procurar. */}
          {semAtendimento.length > 0 && (
            <div className="space-y-1.5 rounded-xl border border-destructive/40 bg-destructive/5 p-3">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-destructive">
                <RefreshCcw className="h-4 w-4 shrink-0" aria-hidden />
                Sem atendimento ({num(semAtendimento.length)})
              </p>
              <p className="text-xs text-muted-foreground">
                Voltaram {num(maxRounds)} vezes para a roleta e ninguém atendeu. Saíram da
                distribuição automática: distribua à mão, realoque ou encerre com motivo.
              </p>
              {semAtendimento.slice(0, 5).map((lead) => (
                <div key={lead.id} className="flex items-center gap-2 rounded-xl border border-border bg-background/60 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => onOpenLead(lead)}
                    className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-md text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{lead.name}</span>
                    <StatusBadge tone="danger" className="shrink-0">
                      {num(lead.roulette_misses)} voltas
                    </StatusBadge>
                  </button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0 gap-1 px-2 text-xs"
                    disabled={paused || distributingId === lead.id}
                    title={paused ? "Distribuição pausada em Admin · Automação de Leads" : undefined}
                    onClick={() => onDistribute(lead)}
                  >
                    <Send className="h-3.5 w-3.5" aria-hidden />
                    {distributingId === lead.id ? "Distribuindo…" : "Distribuir"}
                  </Button>
                </div>
              ))}
              {semAtendimento.length > 5 && (
                <p className="text-xs text-muted-foreground">
                  + {num(semAtendimento.length - 5)} outros sem atendimento.
                </p>
              )}
            </div>
          )}

          {esperando.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-sm font-medium">
                Leads aguardando a roleta ({num(esperando.length)})
              </p>
              {esperando.slice(0, 5).map((lead) => (
                <div key={lead.id} className="flex items-center gap-2 rounded-xl border border-border px-3 py-2">
                  <button
                    type="button"
                    onClick={() => onOpenLead(lead)}
                    className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-md text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{lead.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{dateTime(lead.created_at)}</span>
                  </button>
                  {/* Empurra para a roleta sem escolher corretor — o rodízio
                      continua decidindo quem recebe. Era o que faltava para o
                      gestor destravar um lead parado sem furar a fila. */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0 gap-1 px-2 text-xs"
                    disabled={paused || distributingId === lead.id}
                    title={paused ? "Distribuição pausada em Admin · Automação de Leads" : undefined}
                    onClick={() => onDistribute(lead)}
                  >
                    <Send className="h-3.5 w-3.5" aria-hidden />
                    {distributingId === lead.id ? "Distribuindo…" : "Distribuir"}
                  </Button>
                </div>
              ))}
              {esperando.length > 5 && (
                <p className="text-xs text-muted-foreground">
                  + {num(esperando.length - 5)} outros na fila.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}
