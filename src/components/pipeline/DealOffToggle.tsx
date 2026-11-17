import { useId, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { bareStatus, currentMonthBase } from "@/lib/dealStatus";
import { EMPTY_STATUS_CATALOG, STATUS_DE_CONTRATO, useDealStatusCatalog } from "@/integrations/supabase/dealStatuses";

/** Menor motivo aceito: "ok" não explica por que o negócio saiu da esteira. */
export const MIN_MOTIVO_OFF = 5;

/**
 * OFF, como no sistema anterior: o toggle abre o motivo, obrigatório, e
 * "Aplicar OFF" grava o Status 2 e o comentário juntos (`marcar_off`, 0271).
 * Quem pode: corretor, gerente, diretor, admin e sócio. Sair do OFF é o
 * "Reativar Proposta" do card, que leva o negócio ao mês vigente.
 */
/** "MM/AAAA" → número comparável; inválido vira null. */
const mesNumero = (mes?: string | null) => {
  const m = /^(\d{2})\/(\d{4})$/.exec(mes ?? "");
  return m ? Number(m[2]) * 12 + Number(m[1]) : null;
};

/** O que o encerramento do contrato vai virar (0341): o banco confirma pelo mês. */
export function encerramentoDoContrato(monthBase?: string | null, hoje = currentMonthBase()): "QUEDA" | "DISTRATO" {
  const mes = mesNumero(monthBase);
  const atual = mesNumero(hoje);
  return mes != null && atual != null && mes < atual ? "DISTRATO" : "QUEDA";
}

export function DealOffToggle({
  status, isNew, readOnly, onAplicar, monthBase, onEncerrarContrato,
}: {
  status: string;
  isNew: boolean;
  readOnly: boolean;
  /** Grava o OFF com o motivo; `false` = não gravou (o aviso já saiu). */
  onAplicar: (motivo: string, valorOff: string) => Promise<boolean>;
  /** Mês-base "MM/AAAA": decide Queda (mês vigente) ou Distrato (anterior). */
  monthBase?: string | null;
  /** Contrato não vai para OFF (0341): Queda ou Distrato com motivo. */
  onEncerrarContrato?: (motivo: string) => Promise<boolean>;
}) {
  const id = useId();
  const { can, isAdmin, roles } = useAuth();
  const catalog = useDealStatusCatalog().data ?? EMPTY_STATUS_CATALOG;
  const [abrindo, setAbrindo] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [gravando, setGravando] = useState(false);

  const emOff = bareStatus(status) === "OFF";
  const emContrato = STATUS_DE_CONTRATO.has(bareStatus(status)) && Boolean(onEncerrarContrato);
  const encerramento = encerramentoDoContrato(monthBase);
  const rotulo = encerramento === "QUEDA" ? "Queda" : "Distrato";
  const opcaoOff = catalog.statuses.find((item) => bareStatus(item.value) === "OFF");
  // OFF com motivo é de corretor, gerente, diretor, admin e sócio (12/10/2026,
  // `marcar_off` da 0271); CCA e quem não tem papel de equipe não marcam.
  const podeMarcar = isAdmin || can("deals.mark_off_distrato")
    || roles.some((role) => role === "broker" || role === "manager" || role === "director");
  const bloqueio = emContrato
    ? (!can("deals.edit_status_detail") ? "Seu perfil não pode alterar o Status 2." : !podeMarcar ? "Seu perfil não encerra contrato." : null)
    : !opcaoOff
    ? "OFF não está no cadastro de Status 2."
    : !can("deals.edit_status_detail")
      ? "Seu perfil não pode alterar o Status 2."
      : !podeMarcar ? "Seu perfil não marca OFF." : null;

  const aplicar = async () => {
    if (!emContrato && !opcaoOff) return;
    setGravando(true);
    const gravou = emContrato && onEncerrarContrato
      ? await onEncerrarContrato(motivo.trim())
      : opcaoOff ? await onAplicar(motivo.trim(), opcaoOff.value) : false;
    setGravando(false);
    if (gravou) {
      setAbrindo(false);
      setMotivo("");
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-border/60 p-3">
      <div className="flex items-start gap-3">
        <Switch
          id={id}
          className="mt-0.5 shrink-0"
          checked={emOff || abrindo}
          disabled={emOff || readOnly || isNew || Boolean(bloqueio) || gravando}
          onCheckedChange={(ligado) => { setAbrindo(ligado); if (!ligado) setMotivo(""); }}
        />
        <div className="min-w-0 space-y-1">
          <Label htmlFor={id} className="text-sm font-bold">{emContrato ? rotulo : "OFF"}</Label>
          <p className="text-xs text-muted-foreground">
            {emContrato
              ? encerramento === "QUEDA"
                ? "Contrato do mês vigente que caiu. OFF é só para proposta; o motivo fica no histórico."
                : "Contrato de mês anterior desfeito. OFF é só para proposta; o motivo fica no histórico."
              : "Tira o negócio da esteira, com o motivo registrado no histórico."}
          </p>
        </div>
      </div>
      {emOff && (
        <p className="text-xs text-muted-foreground">Negócio em OFF. Para voltar, use “Reativar Proposta” no card.</p>
      )}
      {!emOff && isNew && <p className="text-xs text-muted-foreground">O OFF vale depois de o negócio ser criado.</p>}
      {!emOff && !isNew && bloqueio && <p className="text-xs text-muted-foreground">{bloqueio}</p>}
      {abrindo && !emOff && (
        <div className="space-y-2">
          <Label htmlFor={`${id}-motivo`} className="text-xs">Motivo {emContrato ? `da ${rotulo.toLowerCase()}` : "do OFF"} (obrigatório)</Label>
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
              {emContrato ? `Aplicar ${rotulo}` : "Aplicar OFF"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
