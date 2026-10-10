import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, MessageCircle, Undo2, UserPlus, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoadingState, PageHeader } from "@/components/shared";
import { useAuth } from "@/contexts/AuthContext";
import { dateTime } from "@/lib/format";
import { describeError } from "@/lib/supabaseError";
import { waNumber } from "@/components/leads/model";
import {
  devolverCandidato, listCandidatos, mudarStatusCandidato, painelCandidatos, pegarCandidato,
  respostasDoCandidato, ROTULO_STATUS, ROTULO_ZONA, type Candidato, type StatusCandidato, type ZonaCandidato,
} from "@/integrations/supabase/candidatos";

const CHAVE = ["candidatos"] as const;
const TODAS = "todas";

/** Nota da Luna: alta (70+) verde, média (40–69) amarela, baixa vermelha. */
const corDaNota = (score: number) =>
  score >= 70 ? "text-emerald-500" : score >= 40 ? "text-amber-500" : "text-red-500";

/**
 * Candidatos a corretor aprovados pela Luna (0264). Sem roleta e sem aviso:
 * gerente e diretor veem todos os disponíveis, filtram por zona e pegam o que
 * quiserem; depois de pego, só quem pegou (e admin/sócio) acompanha.
 */
export default function Candidatos() {
  const { isAdmin, user } = useAuth();
  const qc = useQueryClient();
  const [zona, setZona] = useState<string>(TODAS);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const lista = useQuery({ queryKey: CHAVE, queryFn: listCandidatos, refetchInterval: 60_000 });
  const painel = useQuery({ queryKey: [...CHAVE, "painel"], queryFn: painelCandidatos, enabled: isAdmin });

  const candidatos = useMemo(() => lista.data ?? [], [lista.data]);
  const disponiveis = candidatos.filter((c) => c.status === "disponivel" && (zona === TODAS || c.zona === zona));
  const meus = candidatos.filter((c) => c.status !== "disponivel" && (isAdmin || c.responsavel_id === user?.id));

  async function agir(id: string, acao: () => Promise<void>, sucesso: string, falha: string) {
    setOcupado(id);
    try {
      await acao();
      toast.success(sucesso);
    } catch (e) {
      toast.error(falha, { description: describeError(e, "Tente de novo.") });
    } finally {
      setOcupado(null);
      await qc.invalidateQueries({ queryKey: CHAVE });
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Candidatos"
        icon={Users}
        description="Candidatos a corretor aprovados pela Luna. Escolha pela zona, pegue o candidato e acompanhe a entrevista."
      />

      {isAdmin && painel.data && (
        <Card className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Numero rotulo="Recebidos hoje" valor={painel.data.hoje} />
          <Numero rotulo="Nesta semana" valor={painel.data.semana} />
          <Numero rotulo="Neste mês" valor={painel.data.mes} />
          <div className="text-sm">
            {(Object.keys(ROTULO_STATUS) as StatusCandidato[]).map((s) => (
              <p key={s} className="flex justify-between gap-2">
                <span className="text-muted-foreground">{ROTULO_STATUS[s]}</span>
                <b className="tabular-nums">{painel.data.por_status[s] ?? 0}</b>
              </p>
            ))}
          </div>
          {painel.data.por_gestor.length > 0 && (
            <div className="text-xs sm:col-span-2 lg:col-span-4">
              <p className="mb-1 font-semibold">Por gestor (em entrevista · selecionados · descartados)</p>
              <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                {painel.data.por_gestor.map((g) => (
                  <li key={g.nome ?? "?"} className="flex justify-between gap-2 rounded bg-muted/40 px-2 py-1">
                    <span className="truncate">{g.nome ?? "—"}</span>
                    <span className="tabular-nums">{g.em_entrevista} · {g.selecionado} · {g.descartado}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {lista.isPending && <LoadingState variant="list" rows={3} label="Carregando candidatos…" />}
      {lista.isError && (
        <p className="text-sm text-destructive">{describeError(lista.error, "Não foi possível carregar os candidatos.")}</p>
      )}

      {!lista.isPending && !lista.isError && (
        <Tabs defaultValue="disponiveis">
          <TabsList>
            <TabsTrigger value="disponiveis">Disponíveis ({candidatos.filter((c) => c.status === "disponivel").length})</TabsTrigger>
            <TabsTrigger value="meus">{isAdmin ? "Pegos" : "Meus candidatos"} ({meus.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="disponiveis" className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Zona</span>
              <Select value={zona} onValueChange={setZona}>
                <SelectTrigger className="h-8 w-40" aria-label="Filtrar por zona"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={TODAS}>Todas</SelectItem>
                  {(Object.keys(ROTULO_ZONA) as ZonaCandidato[]).map((z) => (
                    <SelectItem key={z} value={z}>{ROTULO_ZONA[z]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {disponiveis.length === 0 && <p className="text-sm text-muted-foreground">Nenhum candidato disponível nesta zona.</p>}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {disponiveis.map((c) => (
                <CartaoCandidato key={c.id} c={c}>
                  <Button
                    size="sm" className="gap-1" disabled={ocupado === c.id}
                    onClick={() => void agir(c.id, () => pegarCandidato(c.id), `${c.nome} agora é seu`, "Não foi possível pegar o candidato")}
                  >
                    {ocupado === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                    Pegar candidato
                  </Button>
                </CartaoCandidato>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="meus" className="space-y-3">
            {meus.length === 0 && <p className="text-sm text-muted-foreground">Você ainda não pegou nenhum candidato.</p>}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {meus.map((c) => (
                <CartaoCandidato key={c.id} c={c} mostrarDono={isAdmin}>
                  <Select
                    value={c.status}
                    disabled={ocupado === c.id}
                    onValueChange={(v) => void agir(
                      c.id, () => mudarStatusCandidato(c.id, v as StatusCandidato),
                      `${c.nome}: ${ROTULO_STATUS[v as StatusCandidato]}`, "Não foi possível mudar o status",
                    )}
                  >
                    <SelectTrigger className="h-8 w-40" aria-label={`Status de ${c.nome}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(["em_entrevista", "selecionado", "descartado"] as StatusCandidato[]).map((s) => (
                        <SelectItem key={s} value={s}>{ROTULO_STATUS[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {waNumber(c.telefone) && (
                    <Button size="sm" variant="outline" className="gap-1" asChild>
                      <a href={`https://wa.me/${waNumber(c.telefone)}?text=${encodeURIComponent(`Olá ${c.nome}, tudo bem? Aqui é da Faceimob, sobre a vaga de corretor(a).`)}`} target="_blank" rel="noreferrer">
                        <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                      </a>
                    </Button>
                  )}
                  {isAdmin && (
                    <Button
                      size="sm" variant="ghost" className="gap-1" disabled={ocupado === c.id}
                      onClick={() => void agir(c.id, () => devolverCandidato(c.id), `${c.nome} voltou para os disponíveis`, "Não foi possível devolver")}
                    >
                      <Undo2 className="h-3.5 w-3.5" /> Devolver
                    </Button>
                  )}
                </CartaoCandidato>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="text-2xl font-bold tabular-nums">{valor}</p>
    </div>
  );
}

function CartaoCandidato({ c, mostrarDono = false, children }: { c: Candidato; mostrarDono?: boolean; children: React.ReactNode }) {
  const respostas = respostasDoCandidato(c.respostas);
  return (
    <Card className="flex flex-col gap-2 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">{c.nome}</p>
          <p className="text-xs text-muted-foreground">Aprovado pela Luna em {dateTime(c.created_at)}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge variant="outline">{ROTULO_ZONA[c.zona]}</Badge>
          {c.score !== null && <span className={`text-xs font-bold ${corDaNota(c.score)}`}>nota {c.score}</span>}
        </div>
      </div>
      {mostrarDono && (
        <p className="text-xs">
          <span className="text-muted-foreground">Com </span>{c.responsavel?.full_name ?? "—"}
          <span className="text-muted-foreground"> · {ROTULO_STATUS[c.status]}</span>
        </p>
      )}
      {respostas.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          {respostas.map(([campo, valor]) => (
            <div key={campo} className="contents">
              <dt className="text-muted-foreground">{campo}</dt>
              <dd className="font-medium">{valor}</dd>
            </div>
          ))}
        </dl>
      )}
      {c.resumo && <p className="text-xs text-muted-foreground">{c.resumo}</p>}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">{children}</div>
    </Card>
  );
}
