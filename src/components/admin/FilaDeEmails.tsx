import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Mail, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared";
import { supabase } from "@/integrations/supabase/client";
import { dateTime } from "@/lib/format";
import { describeError } from "@/lib/supabaseError";

// `source` e as colunas novas (0157, 0203, 0206) ainda não estão no `types.ts` gerado.
const untyped = supabase as unknown as SupabaseClient;

type LinhaDaFila = {
  id: string;
  created_at: string;
  to_email: string;
  stage_name: string;
  source: "cca" | "pipeline" | "conferencia";
  status: "queued" | "sending" | "sent" | "failed" | "expired";
  last_error: string | null;
  copia: boolean;
};

const STATUS = {
  queued: { tone: "info", texto: "na fila" },
  sending: { tone: "info", texto: "enviando" },
  sent: { tone: "success", texto: "enviado" },
  failed: { tone: "danger", texto: "falhou" },
  expired: { tone: "neutral", texto: "descartado" },
} as const;

const ORIGEM = { cca: "CCA", pipeline: "Pipeline", conferencia: "Conferência" } as const;

/**
 * Os últimos e-mails de movimento (fila `cca_move_emails`), com o motivo de cada
 * falha (03/10/2026: "não estamos recebendo os e-mails, como testar?"). Sem
 * isto a fila só era visível no banco. Só admin lê (policy da 0155).
 */
export function FilaDeEmails() {
  const fila = useQuery({
    queryKey: ["admin", "fila-de-emails"],
    queryFn: async (): Promise<LinhaDaFila[]> => {
      const { data, error } = await untyped
        .from("cca_move_emails")
        .select("id,created_at,to_email,stage_name,source,status,last_error,copia")
        .order("created_at", { ascending: false })
        .limit(15);
      if (error) throw error;
      return (data ?? []) as LinhaDaFila[];
    },
  });

  return (
    <div className="rounded-xl border border-border/50 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Mail className="h-4 w-4 text-primary" aria-hidden /> Últimos e-mails da fila
        </p>
        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => void fila.refetch()}>
          <RefreshCcw className="h-3 w-3" aria-hidden /> Atualizar
        </Button>
      </div>
      {fila.isError ? (
        <p role="alert" className="text-xs text-destructive">{describeError(fila.error, "Não consegui ler a fila de e-mails.")}</p>
      ) : fila.isPending ? (
        <p className="text-xs text-muted-foreground">Consultando…</p>
      ) : (fila.data ?? []).length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhum e-mail entrou na fila ainda. Com os envios ligados, faça um envio para conferência ou mude um Status 2 e
          atualize esta lista.
        </p>
      ) : (
        <ul className="divide-y divide-border text-xs">
          {(fila.data ?? []).map((l) => (
            <li key={l.id} className="py-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={STATUS[l.status]?.tone ?? "neutral"} className="px-1.5 py-0 text-xs">
                  {STATUS[l.status]?.texto ?? l.status}
                </StatusBadge>
                <span className="text-muted-foreground tabular-nums">{dateTime(l.created_at)}</span>
                <span className="font-medium">{ORIGEM[l.source] ?? l.source}</span>
                <span className="min-w-0 flex-1 truncate">{l.stage_name}</span>
                <span className="truncate text-muted-foreground">{l.to_email}{l.copia ? " (cópia)" : ""}</span>
              </div>
              {l.last_error && l.status !== "sent" && <p className="mt-0.5 text-warning">{l.last_error}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
