import type { SupabaseClient } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PhoneOff } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadingState, SectionCard } from "@/components/shared";
import { describeError } from "@/lib/supabaseError";
import { dateTime } from "@/lib/format";
import { seloDeMidia } from "./types";

/** As RPCs da 0120 ainda não estão no `types.ts` gerado; o cast morre no próximo `gen types`. */
const untyped = supabase as unknown as SupabaseClient;

type Telefone = {
  from_phone: string;
  ultima_mensagem: string | null;
  ultima_em: string;
  pendentes: number;
  media_type: string | null;
};

const CHAVE = ["sdr", "whatsapp-sem-lead"];

/**
 * Quem escreveu para o número da empresa sem lead nem conversa, agrupado por
 * telefone (`whatsapp_inbox_unmatched`, 0120). A tabela tinha corpo,
 * `handled_at` e policy de update desde a 0083, e nenhuma tela a lia: o único
 * rastro era o aviso no sino.
 *
 * O CRM não responde a esses números — responder ou virar lead fica fora desta
 * frente —, então a saída é o aparelho e depois "Marcar como resolvido", que
 * grava quem marcou. Ler é de quem lê a tabela (diretor e gerente incluídos);
 * marcar é da mesma porta do banco: administrador, sócio, marketing e SDR.
 */
export function UnmatchedThreads({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const lista = useQuery({
    queryKey: CHAVE,
    queryFn: async () => {
      const { data, error } = await untyped.rpc("whatsapp_inbox_unmatched");
      if (error) throw error;
      return (data ?? []) as Telefone[];
    },
    refetchInterval: 30_000,
  });

  const resolver = useMutation({
    mutationFn: async (telefone: string) => {
      const { data, error } = await untyped.rpc("whatsapp_inbound_resolve_phone", { p_phone: telefone });
      if (error) throw error;
      return Number(data ?? 0);
    },
    onSuccess: (marcadas, telefone) => {
      // Zero é alguém ter resolvido antes: um "resolvido" verde esconderia que
      // este clique não mudou nada.
      if (marcadas === 0) toast.warning(`As mensagens de ${telefone} já tinham sido resolvidas.`);
      else toast.success(marcadas === 1 ? "Mensagem resolvida" : `${marcadas} mensagens resolvidas`, { description: telefone, duration: 2500 });
      return qc.invalidateQueries({ queryKey: CHAVE });
    },
    onError: (e) => toast.error("Não foi possível marcar como resolvido", { description: describeError(e, "Tente de novo.") }),
  });

  const telefones = lista.data ?? [];

  return (
    <SectionCard
      title="Sem lead"
      icon={PhoneOff}
      description="Números que escreveram para a empresa sem lead nem conversa. O CRM não responde a eles: responda pelo aparelho e marque como resolvido."
    >
      {lista.isPending && <LoadingState variant="list" rows={2} label="Carregando mensagens sem lead…" />}
      {lista.error && (
        <p className="text-xs text-destructive">
          {describeError(lista.error, "Não foi possível carregar as mensagens sem lead.")}
        </p>
      )}
      {!lista.isPending && !lista.error && telefones.length === 0 && (
        <p className="text-xs text-muted-foreground">Nenhum número sem lead esperando resposta.</p>
      )}
      {telefones.length > 0 && (
        <ul className="divide-y">
          {telefones.map((t) => {
            const midia = seloDeMidia({ media_type: t.media_type, body: t.ultima_mensagem });
            return (
              <li key={t.from_phone} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-medium">{t.from_phone}</p>
                  {/* `div` e não `p`: o Badge é uma `div`, que não cabe dentro de `p`. */}
                  <div className="flex min-w-0 flex-wrap items-center gap-1 text-sm text-muted-foreground">
                    {midia && (
                      <Badge variant="outline" size="sm" className={midia.falhou ? "border-warning text-warning" : ""}>
                        {midia.rotulo}
                      </Badge>
                    )}
                    <span className="truncate">{t.ultima_mensagem || "(sem texto)"}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t.pendentes} {t.pendentes === 1 ? "mensagem" : "mensagens"} · última em {dateTime(t.ultima_em)}
                  </p>
                </div>
                {canWrite && (
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Marcar como resolvido: ${t.from_phone}`}
                    disabled={resolver.isPending}
                    onClick={() => resolver.mutate(t.from_phone)}
                  >
                    Marcar como resolvido
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!canWrite && telefones.length > 0 && (
        <p className="pt-2 text-xs text-muted-foreground">
          Marcar como resolvido é de administrador, marketing e SDR.
        </p>
      )}
    </SectionCard>
  );
}
