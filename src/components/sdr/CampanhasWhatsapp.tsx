import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { describeError } from "@/lib/supabaseError";
import { sincronizarMeta } from "@/integrations/supabase/analytics";
import {
  ligarCampanhaAoAgente, listCampanhasWhatsapp, type CampanhaWhatsapp,
} from "@/integrations/supabase/sdrCampanhas";
import { SEM_SELECAO, type Agent } from "./types";

const quando = (iso: string | null) => iso
  ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
  : null;

/**
 * Campanhas de WhatsApp da Meta, pelo nome, com o agente que atende quem vem
 * de cada uma (10/10/2026). Todo anúncio da campanha segue a escolha; sem
 * agente, o lead vai direto para a roleta. "Atualizar campanhas" roda a
 * sincronização da Meta na hora, sem esperar a de hora em hora.
 */
export function CampanhasWhatsapp({ agents, canWrite, onChange }: {
  agents: Agent[];
  canWrite: boolean;
  onChange: () => void;
}) {
  const { can } = useAuth();
  const [campanhas, setCampanhas] = useState<CampanhaWhatsapp[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizando, setAtualizando] = useState(false);
  const [gravando, setGravando] = useState<string | null>(null);
  const podeSincronizar = can("marketing.meta_manage");

  const carregar = useCallback(async () => {
    try {
      setCampanhas(await listCampanhasWhatsapp());
      setErro(null);
    } catch (e) {
      setErro(describeError(e, "Não consegui carregar as campanhas."));
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const atualizar = async () => {
    setAtualizando(true);
    try {
      const resultado = await sincronizarMeta();
      const falhas = resultado.contas.filter((conta) => conta.status === "falhou");
      if (falhas.length) toast.error("A Meta não atualizou tudo", { description: falhas[0].erro });
      else toast.success("Campanhas atualizadas");
      await carregar();
    } catch (e) {
      toast.error("Não foi possível atualizar", { description: describeError(e, "Tente de novo em instantes.") });
    } finally {
      setAtualizando(false);
    }
  };

  const escolher = async (campanha: CampanhaWhatsapp, valor: string) => {
    setGravando(campanha.external_id);
    try {
      await ligarCampanhaAoAgente(campanha, valor === SEM_SELECAO ? null : valor);
      toast.success(valor === SEM_SELECAO ? "Campanha vai direto para a roleta" : "Agente ligado à campanha");
      await carregar();
      onChange();
    } catch (e) {
      toast.error("Não foi possível salvar", { description: describeError(e, "A escolha não foi gravada.") });
    } finally {
      setGravando(null);
    }
  };

  const ultima = campanhas?.reduce<string | null>((max, c) => (c.synced_at && (!max || c.synced_at > max) ? c.synced_at : max), null) ?? null;

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold">Campanhas de WhatsApp</p>
          <p className="text-xs text-muted-foreground">
            Escolha o agente de cada campanha: todo anúncio dela segue a escolha. Sem agente, o lead vai direto para a roleta.
            {ultima && ` Última atualização: ${quando(ultima)}.`}
          </p>
        </div>
        {podeSincronizar && (
          <Button size="sm" variant="outline" className="gap-1" disabled={atualizando} onClick={() => void atualizar()}>
            {atualizando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {atualizando ? "Atualizando…" : "Atualizar campanhas"}
          </Button>
        )}
      </div>

      {erro && <p className="text-xs text-destructive">{erro}</p>}
      {campanhas === null && !erro && <p className="text-xs text-muted-foreground">Carregando campanhas…</p>}
      {campanhas?.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Nenhuma campanha de WhatsApp sincronizada ainda.{podeSincronizar ? " Clique em “Atualizar campanhas”." : ""}
        </p>
      )}

      <ul className="space-y-2">
        {(campanhas ?? []).map((campanha) => {
          const ativa = campanha.status === "ACTIVE";
          return (
            <li key={campanha.external_id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 p-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{campanha.name}</p>
                <Badge variant="outline" className={ativa ? "border-success/50 text-success" : "text-muted-foreground"}>
                  {ativa ? "Ativa" : "Pausada"}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                {gravando === campanha.external_id && <Loader2 className="h-4 w-4 animate-spin" aria-label="Salvando" />}
                <Select
                  value={campanha.sdr_agent_id ?? SEM_SELECAO}
                  disabled={!canWrite || gravando !== null}
                  onValueChange={(valor) => void escolher(campanha, valor)}
                >
                  <SelectTrigger className="h-8 w-52 text-xs" aria-label={`Agente da campanha ${campanha.name}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SEM_SELECAO}>Sem agente · direto para a roleta</SelectItem>
                    {agents.filter((agente) => agente.active).map((agente) => (
                      <SelectItem key={agente.id} value={agente.id}>{agente.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
