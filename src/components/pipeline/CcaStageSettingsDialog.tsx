import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { dbError, describeError } from "@/lib/supabaseError";
import { supabase } from "@/integrations/supabase/client";
import { ColorField } from "@/components/shared";
import { TONE_HEX } from "@/lib/tone";
import { CCA_STATUS_OPTIONS, ccaStageColor, ccaStatusLabel, type CcaCaseStatus } from "./ccaStage";
import { ccaKeys, ccaStageNotifiesSales, loadCcaStatusOptions, type CcaStage } from "./ccaData";

/** Selo da lista: raio da escala (`rounded-md`), sem pílula. */
const SELO = "rounded-md border border-border px-1.5 py-0.5 text-xs leading-none";

/** Cor de estágio novo: um azul, "em andamento". */
const COR_INICIAL = TONE_HEX.info;

/**
 * Criar, renomear, recolorir e excluir estágio da esteira. Só admin e sócio
 * chegam aqui: `cca_stages_write` é `is_admin()` desde a 0151.
 *
 * Duas correções: o **desfecho** passa a ser escolhido (P10) e a **cor** é
 * gravada como `#RRGGBB` pelo seletor nativo (0153) — era classe do Tailwind
 * (T14), depois uma de seis chaves, e as 19 colunas repetiam cor. Excluir pede
 * confirmação em `AlertDialog` — era `window.confirm`, que alguns navegadores
 * suprimem e que não é estilizável nem anunciável.
 *
 * **Status 2 gravado** (0150): a coluna grava esse Status 2 no negócio quando o
 * caso entra nela. A lista já sai sem os rótulos de envio ("13. ESTEIRA AGIL",
 * "15. ANÁLISE P/ VIRAR NEGÓCIO"), OFF, QUEDA e DISTRATO (`ccaColumnStatusAllowed`);
 * "RET. ESTEIRA AGIL" fica, porque é o da coluna RETORNO À ESTEIRA ÁGIL. Se
 * mesmo assim o banco recusar (P0001), a frase dele vai ao toast.
 *
 * **Avisa ou não, muda ou não o status** (0155, pedido do cliente de 18/09):
 * "Avisar o comercial" é `notify_sales` — desligado, a coluna é movimento
 * interno da CCA e só o histórico do negócio registra. "Muda o status do
 * negócio" é `deal_status_id` preenchido; desligado grava `null`, e mover pela
 * esteira não toca o Status 2.
 */
export function CcaStageSettingsDialog({ stages, onClose, onChanged }: {
  stages: CcaStage[];
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const nomeRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<CcaStage | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(COR_INICIAL);
  const [status, setStatus] = useState<CcaCaseStatus>("under_review");
  const [notifySales, setNotifySales] = useState(true);
  const [mudaStatus, setMudaStatus] = useState(false);
  // `""` = nenhum escolhido: o Select volta ao placeholder.
  const [dealStatusId, setDealStatusId] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<CcaStage | null>(null);
  const catalogo = useQuery({ queryKey: ccaKeys.statusOptions, queryFn: loadCcaStatusOptions });
  // Inativo só aparece se já for o da coluna: some da escolha nova, mas a
  // ligação existente continua visível em vez de parecer "nenhum".
  const opcoes = (catalogo.data ?? []).filter((option) => option.active || option.id === dealStatusId);
  const rotuloDoStatus = (id: string | null | undefined) =>
    catalogo.data?.find((option) => option.id === id)?.label;

  const reset = () => {
    setEditing(null); setName(""); setColor(COR_INICIAL); setStatus("under_review");
    setNotifySales(true); setMudaStatus(false); setDealStatusId("");
  };

  // "Muda o status" ligado sem escolher qual gravaria `null` calado.
  const faltaStatus = mudaStatus && !dealStatusId;

  const save = async () => {
    if (!name.trim() || faltaStatus) return;
    setSaving(true);
    try {
      // Sempre `#RRGGBB` (ver o `ColorField` abaixo): o CHECK da 0153 recusa
      // qualquer formato fora do hex e das chaves antigas.
      const payload = {
        name: name.trim(), color, status,
        deal_status_id: mudaStatus ? dealStatusId : null,
        notify_sales: notifySales,
      };
      if (editing) {
        // `.select("id")`: UPDATE recusado pela RLS volta 204 sem erro, e o aviso
        // diria "Estágio atualizado" sem ter gravado (mesma regra de `updateDeal`).
        const { data, error } = await supabase
          .from("cca_stages").update(payload).eq("id", editing.id).select("id");
        if (error) throw error;
        if (!data?.length) {
          throw dbError("cca_stages", {
            code: "P0001",
            message: "Ele pode ter sido removido por outra pessoa ou seu perfil não tem permissão. Recarregue a página.",
          });
        }
      } else {
        const { error } = await supabase.from("cca_stages").insert({ ...payload, position: Math.max(0, ...stages.map((s) => s.position)) + 1 });
        if (error) throw error;
      }
      toast({ variant: "success", title: editing ? "Estágio atualizado" : "Estágio criado" });
      reset();
      await onChanged();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Não foi possível salvar o estágio",
        description: describeError(err, "Tente de novo."),
      });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (stage: CcaStage) => {
    try {
      const { data, error } = await supabase.from("cca_stages").delete().eq("id", stage.id).select("id");
      if (error) throw error;
      if (!data?.length) {
        throw dbError("cca_stages", {
          code: "P0001",
          message: "Ele pode já ter sido removido por outra pessoa ou seu perfil não tem permissão. Recarregue a página.",
        });
      }
      toast({ variant: "success", title: "Estágio excluído" });
      await onChanged();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Não foi possível excluir o estágio",
        description: describeError(err, "O estágio continua na esteira."),
      });
    } finally {
      setRemoving(null);
    }
  };

  const reorder = async (index: number, direction: number) => {
    const ids = stages.map((s) => s.id);
    [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]];
    setSaving(true);
    try {
      // RPC da 0156; remover a ponte quando types.ts for regenerado.
      const { error } = await supabase.rpc("reorder_cca_stages" as never, { p_stage_ids: ids } as never);
      if (error) throw error;
      await onChanged();
      toast({ variant: "success", title: "Ordem das colunas atualizada" });
    } catch (error) {
      toast({ variant: "destructive", title: "Não foi possível reordenar", description: describeError(error, "A ordem não foi alterada.") });
    } finally { setSaving(false); }
  };

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        {/* Altura e largura cabem na tela pela base do `DialogContent`; aqui só
            o corpo rola, com cabeçalho e rodapé fixos. Com as 19 colunas a lista
            passava da altura da tela e o diálogo, fixo e centrado, não rolava. */}
        <DialogContent className="flex flex-col gap-0 p-0 sm:max-w-lg">
          <DialogHeader className="shrink-0 border-b border-border p-4 pr-12 sm:p-6 sm:pr-12">
            <DialogTitle className="break-words leading-tight">
              {editing ? `Editar "${editing.name}"` : "Gerenciar estágios do CCA"}
            </DialogTitle>
            <DialogDescription>
              O desfecho liga o estágio ao ciclo fixo do crédito: é ele que decide o caso e move o
              negócio no Pipeline. Cada coluna diz se avisa o comercial e se muda o status do negócio.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="cca-stage-name">Nome</Label>
                <Input
                  ref={nomeRef}
                  id="cca-stage-name" className="mt-1" value={name} placeholder="Ex.: Conferência final"
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="cca-stage-color">Cor</Label>
                <div className="mt-1">
                  {/* Toda coluna tem cor: "Sem cor" vira o cinza de verdade, e o
                      seletor mostra esse cinza — o vazio do `ColorField` aparece
                      como preto, que a coluna nunca teria. */}
                  <ColorField id="cca-stage-color" value={color} onChange={(c) => setColor(c || TONE_HEX.neutral)} />
                </div>
              </div>
              <div>
                <Label htmlFor="cca-stage-status">Desfecho</Label>
                <Select value={status} onValueChange={(value) => setStatus(value as CcaCaseStatus)}>
                  <SelectTrigger id="cca-stage-status" className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CCA_STATUS_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-start justify-between gap-3 rounded-xl border border-border p-3 sm:col-span-2">
                <div className="min-w-0">
                  <Label htmlFor="cca-stage-notify">Avisar o comercial</Label>
                  <p id="cca-stage-notify-help" className="mt-0.5 text-xs text-muted-foreground">
                    Ligado: o corretor e o gerente do negócio recebem a mensagem de quem moveu, no app, no
                    celular e por e-mail (quando o envio estiver ligado em Integrações). Desligado: movimento
                    interno da CCA, a mensagem fica só no histórico do negócio.
                  </p>
                  {!notifySales && status === "pending_documents" && (
                    <p className="mt-1 text-xs text-warning">
                      Com o desfecho “Aguardando documentos” o dossiê pode voltar ao corretor, e o aviso de
                      devolução chega a ele mesmo em movimento interno.
                    </p>
                  )}
                </div>
                <Switch
                  id="cca-stage-notify" aria-describedby="cca-stage-notify-help"
                  checked={notifySales} onCheckedChange={setNotifySales}
                />
              </div>
              <div className="space-y-2 rounded-xl border border-border p-3 sm:col-span-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Label htmlFor="cca-stage-muda-status">Muda o status do negócio</Label>
                    <p id="cca-stage-muda-status-help" className="mt-0.5 text-xs text-muted-foreground">
                      Ligado: grava o Status 2 escolhido no negócio, que aparece no Pipeline, nos filtros e na
                      planilha. Desligado: o status do negócio fica como está.
                    </p>
                  </div>
                  <Switch
                    id="cca-stage-muda-status" aria-describedby="cca-stage-muda-status-help"
                    checked={mudaStatus} onCheckedChange={setMudaStatus}
                  />
                </div>
                {mudaStatus && (
                  <div>
                    <Label htmlFor="cca-stage-deal-status">Status 2 que a coluna grava</Label>
                    <Select value={dealStatusId} onValueChange={setDealStatusId} disabled={catalogo.isPending}>
                      <SelectTrigger id="cca-stage-deal-status" className="mt-1" aria-describedby="cca-stage-deal-status-help">
                        <SelectValue placeholder="Escolha o status" />
                      </SelectTrigger>
                      <SelectContent>
                        {opcoes.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {option.label}{option.active ? "" : " (inativo)"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {/* A lista sai sem os status que o banco recusa na coluna
                        (`cca_stages_guard_deal_status`): sem a frase, a ausência
                        de "13. ESTEIRA AGIL" ou de OFF parece defeito. */}
                    <p id="cca-stage-deal-status-help" className="mt-1 text-xs text-muted-foreground">
                      Os status de envio (esteira ágil, análise p/ virar negócio) e de encerramento (OFF,
                      distrato, queda) não aparecem: quem grava é o sistema.
                    </p>
                    {faltaStatus && (
                      <p className="mt-1 text-xs text-warning">Escolha o status ou desligue a opção.</p>
                    )}
                    {catalogo.isError && (
                      <p role="alert" className="mt-1 text-xs text-destructive">
                        {describeError(catalogo.error, "Não consegui carregar o catálogo de Status 2.")}
                      </p>
                    )}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <Button size="sm" disabled={saving || !name.trim() || faltaStatus} onClick={() => void save()}>
                  <Plus className="mr-1 h-4 w-4" /> {editing ? "Salvar" : "Criar estágio"}
                </Button>
                {editing && <Button size="sm" variant="ghost" onClick={reset}>Cancelar edição</Button>}
              </div>
            </div>

            <ul className="space-y-2">
              {stages.map((stage, index) => {
                // Reserva: o rótulo que o quadro já carrega (0155). O catálogo é
                // filtrado e pode falhar; sem ela o selo ficava em "…" para sempre.
                const gravado = rotuloDoStatus(stage.deal_status_id) ?? stage.deal_status?.label;
                return (
                  <li key={stage.id} className="flex items-center justify-between gap-2 rounded-xl border border-border bg-muted/20 p-2">
                    {/* Nome em linha própria e sem corte: com as 19 colunas da 0150
                        os nomes são longos e parecidos ("ANÁLISE CEOPF", "INCONFORME
                        CEOPF"), e é por ele que se escolhe qual editar. */}
                    <div className="flex min-w-0 items-start gap-2">
                      <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: ccaStageColor(stage.color) }} aria-hidden />
                      <div className="min-w-0">
                        <p className="break-words text-xs font-medium">{stage.name}</p>
                        <p className="break-words text-xs text-muted-foreground">{ccaStatusLabel(stage.status)}</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {ccaStageNotifiesSales(stage)
                            ? <span className={`${SELO} text-foreground`}>Avisa o comercial</span>
                            : <span className={`${SELO} bg-muted text-muted-foreground`}>Movimento interno</span>}
                          <span className={`${SELO} text-muted-foreground`}>
                            {stage.deal_status_id ? `Grava: ${gravado ?? "…"}` : "Não muda o status"}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-shrink-0 gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" disabled={saving || index === 0}
                        aria-label={`Mover ${stage.name} para a esquerda`} onClick={() => void reorder(index, -1)}><ArrowUp className="h-3 w-3" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" disabled={saving || index === stages.length - 1}
                        aria-label={`Mover ${stage.name} para a direita`} onClick={() => void reorder(index, 1)}><ArrowDown className="h-3 w-3" /></Button>
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7"
                        aria-label={`Editar o estágio ${stage.name}`}
                        disabled={saving}
                        onClick={() => {
                          setEditing(stage);
                          setName(stage.name);
                          // Chave antiga abre com o hex dela: salvar grava hex.
                          setColor(ccaStageColor(stage.color));
                          setStatus(stage.status);
                          setNotifySales(ccaStageNotifiesSales(stage));
                          setMudaStatus(Boolean(stage.deal_status_id));
                          setDealStatusId(stage.deal_status_id ?? "");
                          // O formulário fica no alto do corpo rolável: editar a
                          // última coluna o deixava fora de vista. O foco rola até ele.
                          nomeRef.current?.focus();
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                        aria-label={`Excluir o estágio ${stage.name}`}
                        disabled={saving}
                        onClick={() => setRemoving(stage)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <DialogFooter className="shrink-0 border-t border-border p-4 sm:px-6">
            <Button variant="outline" onClick={onClose}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {removing && (
        <AlertDialog open onOpenChange={(open) => !open && setRemoving(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir o estágio "{removing.name}"?</AlertDialogTitle>
              <AlertDialogDescription>
                Os casos que estiverem nele ficam sem estágio: passam para a primeira coluna de mesmo
                desfecho e, sem nenhuma, saem do quadro. Não dá para desfazer.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={(event) => { event.preventDefault(); void remove(removing); }}>
                Excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
