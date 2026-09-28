import { useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SectionCard } from "@/components/shared";
import { usePeople } from "@/components/pipeline/data";
import { directorExternalCheckin, listTodayExternalCheckins } from "@/integrations/supabase/checkin";
import { describeError } from "@/lib/supabaseError";
import { dateTime } from "@/lib/format";

const MOTIVO_MIN = 5;
const MOTIVO_MAX = 500;

/**
 * Check-in externo (pedido do diretor em 29/09/2026): o corretor de plantão
 * fora da loja não tem o IP liberado, e o diretor faz o ponto por ele com o
 * motivo escrito. Quem vale é a RPC `director_external_checkin` (0162) — ela
 * recusa quem está fora da equipe, fora da janela ou travado por atraso. A
 * lista do dia fica embaixo: o motivo registrado é o que dá sentido à exceção.
 */
export function CheckinExterno({ selfId }: { selfId: string | null }) {
  const queryClient = useQueryClient();
  const people = usePeople();
  const hoje = useQuery({ queryKey: ["checkin", "externos"], queryFn: listTodayExternalCheckins });
  const [corretor, setCorretor] = useState("");
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);

  const corretores = useMemo(() => (people.data ?? [])
    .filter((p) => p.active && p.roles.includes("broker") && p.id !== selfId)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")), [people.data, selfId]);
  const nomePorId = useMemo(() => new Map((people.data ?? []).map((p) => [p.id, p.name])), [people.data]);

  const motivoLimpo = motivo.trim();
  const motivoCurto = motivoLimpo.length > 0 && motivoLimpo.length < MOTIVO_MIN;
  const podeEnviar = Boolean(corretor) && motivoLimpo.length >= MOTIVO_MIN && !enviando;

  const enviar = async (event: FormEvent) => {
    event.preventDefault();
    if (!podeEnviar) return;
    setEnviando(true);
    try {
      await directorExternalCheckin(corretor, motivoLimpo);
      toast.success("Check-in externo feito", {
        description: `${nomePorId.get(corretor) ?? "O corretor"} entrou na roleta. Motivo registrado.`,
      });
      setCorretor("");
      setMotivo("");
      await queryClient.invalidateQueries({ queryKey: ["checkin"] });
    } catch (error: unknown) {
      toast.error("Não foi possível fazer o check-in externo", {
        description: describeError(error, "Tente de novo em instantes."),
      });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <SectionCard
      title="Check-in externo (plantão)"
      description="Para corretor da sua equipe que está fora da loja. Não precisa do IP; o motivo fica registrado."
      icon={MapPin}
    >
      <form onSubmit={enviar} className="space-y-3" aria-label="Check-in externo">
        <div className="space-y-1.5">
          <Label htmlFor="checkin-externo-corretor">Corretor</Label>
          <Select value={corretor} onValueChange={setCorretor} disabled={people.isPending}>
            <SelectTrigger id="checkin-externo-corretor">
              <SelectValue placeholder={people.isPending ? "Carregando…" : "Escolha o corretor"} />
            </SelectTrigger>
            <SelectContent>
              {corretores.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {people.error && (
            <p className="text-xs text-destructive">{describeError(people.error, "Não consegui carregar a equipe.")}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="checkin-externo-motivo">Motivo</Label>
          <Textarea
            id="checkin-externo-motivo" value={motivo} maxLength={MOTIVO_MAX} rows={2}
            placeholder="Ex.: plantão no estande do Residencial Jardim"
            onChange={(e) => setMotivo(e.target.value)}
            aria-invalid={motivoCurto}
            aria-describedby={motivoCurto ? "checkin-externo-motivo-erro" : undefined}
          />
          {motivoCurto && (
            <p id="checkin-externo-motivo-erro" className="text-xs text-destructive">
              Escreva o motivo com pelo menos {MOTIVO_MIN} letras.
            </p>
          )}
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={!podeEnviar}>{enviando ? "Registrando…" : "Fazer check-in externo"}</Button>
        </div>
      </form>

      <div className="mt-4 border-t border-border pt-3">
        <h3 className="mb-2 text-xs font-semibold text-muted-foreground">Check-ins externos de hoje</h3>
        {hoje.error ? (
          <p className="text-xs text-destructive">{describeError(hoje.error, "Não consegui carregar a lista de hoje.")}</p>
        ) : !hoje.data?.length ? (
          <p className="text-xs text-muted-foreground">{hoje.isPending ? "Carregando…" : "Nenhum hoje."}</p>
        ) : (
          <ul className="space-y-1.5 text-xs">
            {hoje.data.map((c) => (
              <li key={c.id}>
                <span className="font-medium">{nomePorId.get(c.profile_id) ?? "Corretor"}</span>
                <span className="text-muted-foreground"> · {dateTime(c.checked_in_at)}</span>
                {c.external_by && <span className="text-muted-foreground"> · por {nomePorId.get(c.external_by) ?? "diretor"}</span>}
                <span className="block text-muted-foreground">{c.external_reason}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}
