import { useCallback, useEffect, useId, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { dateTime } from "@/lib/format";
import { describeError } from "@/lib/supabaseError";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { PersonRecord } from "@/integrations/supabase/newSchema";

type DealComment = { id: string; actor_id: string | null; to_value: string | null; created_at: string };

/**
 * Comentários manuais do negócio (`deal_history`, `kind = 'comment'`).
 *
 * A escrita é pela RPC `add_deal_comment`: `deal_history` é log imutável e não
 * aceita insert direto de ninguém.
 */
export function DealCommentsPanel({ dealId, people }: { dealId: string; people: PersonRecord[] }) {
  const id = useId();
  const [comments, setComments] = useState<DealComment[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("deal_history")
      .select("id,actor_id,to_value,created_at")
      .eq("deal_id", dealId)
      .eq("kind", "comment")
      .order("created_at", { ascending: true });
    if (!error) setComments((data as DealComment[]) || []);
  }, [dealId]);

  useEffect(() => { void load(); }, [load]);

  const authorName = (actorId: string | null) =>
    actorId ? people.find((person) => person.id === actorId)?.name ?? "—" : "sistema";

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    try {
      const { error } = await supabase.rpc("add_deal_comment", { p_deal_id: dealId, p_body: body });
      if (error) throw error;
      setDraft("");
      await load();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Comentário não gravado",
        description: describeError(err, "Tente de novo."),
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="border-t border-border pt-3">
      <h3 className="mb-2 text-sm font-bold">Comentários</h3>
      <div className="max-h-40 space-y-2 overflow-y-auto">
        {comments.map((entry) => (
          <p key={entry.id} className="text-xs">
            <span className="text-muted-foreground">{dateTime(entry.created_at)} </span>
            <span className="font-bold text-primary">{authorName(entry.actor_id)}:</span>{" "}
            <span className="text-muted-foreground">{entry.to_value}</span>
          </p>
        ))}
        {comments.length === 0 && <p className="text-xs text-muted-foreground">Nenhum comentário ainda.</p>}
      </div>
      <div className="mt-2 flex gap-2">
        <Label htmlFor={`${id}-draft`} className="sr-only">Novo comentário</Label>
        <Textarea
          id={`${id}-draft`} rows={2} className="flex-1 text-xs"
          value={draft} onChange={(event) => setDraft(event.target.value)}
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
