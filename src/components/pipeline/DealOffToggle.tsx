import { useId, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { bareStatus } from "@/lib/dealStatus";
import { EMPTY_STATUS_CATALOG, statusMoveBlock, useDealStatusCatalog } from "@/integrations/supabase/dealStatuses";
import { offDistratoBlocked } from "./useDealActions";

/** Menor motivo aceito: "ok" não explica por que o negócio saiu da esteira. */
export const MIN_MOTIVO_OFF = 5;

/**
 * OFF no Cadastro (10/10/2026), como no sistema anterior: o toggle abre o
 * motivo, obrigatório, e "Aplicar OFF" grava o Status 2 e o comentário juntos.
 * Quem pode é a mesma regra do Select de Status 2 (admin e sócio, ou de
 * REPROVADO quem edita o negócio, 0231). Sair do OFF é o "Reativar Proposta"
 * do card, que leva o negócio ao mês vigente.
 */
export function DealOffToggle({
  status, isNew, readOnly, onAplicar,
}: {
  status: string;
  isNew: boolean;
  readOnly: boolean;
  /** Grava o OFF com o motivo; `false` = não gravou (o aviso já saiu). */
  onAplicar: (motivo: string, valorOff: string) => Promise<boolean>;
}) {
  const id = useId();
  const { can, isAdmin, roles } = useAuth();
  const catalog = useDealStatusCatalog().data ?? EMPTY_STATUS_CATALOG;
  const [abrindo, setAbrindo] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [gravando, setGravando] = useState(false);

  const emOff = bareStatus(status) === "OFF";
  const opcaoOff = catalog.statuses.find((item) => bareStatus(item.value) === "OFF");
  const bloqueio = !opcaoOff
    ? "OFF não está no cadastro de Status 2."
    : offDistratoBlocked(can, opcaoOff.value, isNew ? null : status)
      ?? (isNew ? null : statusMoveBlock(catalog, status, opcaoOff.value, { isAdmin, roles }));

  const aplicar = async () => {
    if (!opcaoOff) return;
    setGravando(true);
    const gravou = await onAplicar(motivo.trim(), opcaoOff.value);
    setGravando(false);
    if (gravou) {
      setAbrindo(false);
      setMotivo("");
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-border/60 p-3">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id} className="text-sm font-bold">OFF</Label>
        <Switch
          id={id}
          checked={emOff || abrindo}
          disabled={emOff || readOnly || isNew || Boolean(bloqueio) || gravando}
          onCheckedChange={(ligado) => { setAbrindo(ligado); if (!ligado) setMotivo(""); }}
        />
      </div>
      {emOff && (
        <p className="text-xs text-muted-foreground">Negócio em OFF. Para voltar, use “Reativar Proposta” no card.</p>
      )}
      {!emOff && isNew && <p className="text-xs text-muted-foreground">O OFF vale depois de o negócio ser criado.</p>}
      {!emOff && !isNew && bloqueio && <p className="text-xs text-muted-foreground">{bloqueio}</p>}
      {abrindo && !emOff && (
        <div className="space-y-2">
          <Label htmlFor={`${id}-motivo`} className="text-xs">Motivo do OFF (obrigatório)</Label>
          <Textarea
            id={`${id}-motivo`}
            value={motivo}
            onChange={(event) => setMotivo(event.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="Ex.: cliente desistiu da compra; sem retorno há 30 dias."
            className="text-xs"
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { setAbrindo(false); setMotivo(""); }}>
              Cancelar
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="h-8 gap-1 text-xs"
              disabled={gravando || motivo.trim().length < MIN_MOTIVO_OFF}
              onClick={() => void aplicar()}
            >
              {gravando && <Loader2 className="h-3 w-3 animate-spin" />}
              Aplicar OFF
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
