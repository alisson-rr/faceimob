import { useCallback, useEffect, useId, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { dateTime } from "@/lib/format";
import { brokerTextClass } from "@/lib/tone";
import { describeError } from "@/lib/supabaseError";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { dealParticipantNames } from "@/integrations/supabase/documents";
import type { PersonRecord } from "@/integrations/supabase/newSchema";

type DealComment = { id: string; actor_id: string | null; to_value: string | null; created_at: string };

/**
 * Quantos comentários o negócio tem — para o contador da aba, que é decidido
 * fora deste painel (o painel só monta quando a aba já está aberta).
 *
 * Falha de rede devolve 0 em vez de estourar: é um número decorativo ao lado de
 * um rótulo, e derrubar a barra de abas por causa dele seria pior que mostrar a
 * aba sem contador. O erro de verdade — o da LISTA — aparece dentro do painel.
 */
export async function countDealComments(dealId: string): Promise<number> {
  const { count, error } = await supabase
    .from("deal_history")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", dealId)
    .eq("kind", "comment");
  if (error) {
    console.warn("[comentários] não deu para contar:", error.message);
    return 0;
  }
  return count ?? 0;
}

/**
 * Comentários manuais do negócio (`deal_history`, `kind = 'comment'`).
 *
 * A escrita é pela RPC `add_deal_comment`: `deal_history` é log imutável e não
 * aceita insert direto de ninguém.
 */
export function DealCommentsPanel({ dealId, people }: { dealId: string; people: PersonRecord[] }) {
  const id = useId();
  const [comments, setComments] = useState<DealComment[]>([]);
  /** Nome de quem participa do negócio, vindo da RPC `deal_participant_names`.
   *  `people` sai de `profiles`, e `profiles_select` é `auth_visible_profiles()`:
   *  o corretor NÃO enxerga o perfil do gerente, então o comentário do gerente
   *  aparecia como "—" — sem nome e, agora, sem cor — justamente para quem mais
   *  precisa saber quem falou. A RPC (0027) é `security definer` e responde por
   *  negócio que a pessoa já pode abrir. */
  const [participantes, setParticipantes] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  /** Falha da LEITURA, separada do vazio: `if (!error)` deixava a lista em `[]` e
   *  a tela dizia "Nenhum comentário ainda" para uma consulta que nem voltou. */
  const [erro, setErro] = useState<unknown>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("deal_history")
      .select("id,actor_id,to_value,created_at")
      .eq("deal_id", dealId)
      .eq("kind", "comment")
      .order("created_at", { ascending: true });
    setErro(error);
    if (!error) setComments((data as DealComment[]) || []);
  }, [dealId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    let ativo = true;
    // Num `catch` próprio: nome que não veio vira "—", e isso não pode derrubar
    // a lista de comentários, que já carregou por outro caminho.
    dealParticipantNames(dealId)
      .then((nomes) => { if (ativo) setParticipantes(nomes); })
      .catch((falha) => console.warn("[comentários] não deu para nomear os autores:", falha));
    return () => { ativo = false; };
  }, [dealId]);

  const authorName = (actorId: string | null) => {
    if (!actorId) return "sistema";
    return people.find((person) => person.id === actorId)?.name ?? participantes[actorId] ?? "—";
  };

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    try {
      const { error } = await supabase.rpc("add_deal_comment", { p_deal_id: dealId, p_body: body });
      if (error) throw error;
      setDraft("");
      toast({ variant: "success", title: "Comentário adicionado" });
      await load();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Não foi possível adicionar o comentário",
        description: describeError(err, "Tente de novo."),
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-bold">
        Comentários
        {comments.length > 0 && (
          <span className="ml-1 font-normal text-muted-foreground">({comments.length})</span>
        )}
      </h3>

      {erro ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {describeError(erro, "Não consegui carregar os comentários deste negócio.")}
        </p>
      ) : (
        <ul className="max-h-80 space-y-1.5 overflow-y-auto">
          {comments.map((entry) => {
            const nome = authorName(entry.actor_id);
            return (
              // A cor sai do NOME (`brokerTextClass`), a mesma que pinta o
              // corretor no Pipeline: quem fala tem sempre a mesma cor, em
              // qualquer tela e em qualquer ordem de leitura. `border-current`
              // herda essa cor na faixa lateral sem inventar uma classe de borda
              // que o Tailwind não enxergaria (a classe nasce montada em
              // `tone.ts`, e concatenar `border-` no nome dela a apagaria do
              // bundle). Só o autor fica colorido — o corpo continua em
              // `foreground`, que é o que precisa de contraste de leitura.
              <li
                key={entry.id}
                className={`rounded-md border-l-2 border-current bg-muted/20 px-2 py-1.5 ${brokerTextClass(nome)}`}
              >
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-xs font-bold">{nome}</span>
                  <span className="text-xs text-muted-foreground">{dateTime(entry.created_at)}</span>
                </div>
                {/* `whitespace-pre-wrap`: o campo é um textarea e o comentário de
                    duas linhas virava um parágrafo só. */}
                <p className="whitespace-pre-wrap break-words text-xs text-foreground">{entry.to_value}</p>
              </li>
            );
          })}
          {comments.length === 0 && (
            <li className="text-xs text-muted-foreground">Nenhum comentário ainda.</li>
          )}
        </ul>
      )}

      <div className="flex gap-2">
        <Label htmlFor={`${id}-draft`} className="sr-only">Novo comentário</Label>
        <Textarea
          id={`${id}-draft`} rows={2} className="flex-1 text-xs"
          value={draft} onChange={(event) => setDraft(event.target.value)}
          // 4000 é o teto que `add_deal_comment` cobra: sem isto o texto longo só
          // era recusado depois do clique, com a frase crua do banco em toast.
          maxLength={4000}
          placeholder="Escreva o próximo passo deste negócio…"
        />
        <Button
          size="icon" className="h-9 w-9 self-end" aria-label="Enviar comentário"
          disabled={sending || !draft.trim()} onClick={() => void send()}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
