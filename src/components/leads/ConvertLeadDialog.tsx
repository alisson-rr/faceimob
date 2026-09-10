import { useId, useState } from "react";
import { AlertTriangle, ArrowRightCircle, Paperclip, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { describeError } from "@/lib/supabaseError";
import {
  addLeadComment, ATTACHMENT_HINT, convertLeadToDeal, leadStatusLabel, promoteLeadAttachments,
  rejectAttachment, uploadLeadAttachment, type LeadRecord,
} from "@/integrations/supabase/leads";
import { useDeveloperProjects, useDevelopers, useInvalidateLeads } from "./data";
import { FileDropzone } from "./FileDropzone";
import { parseVgvInput } from "./model";

/**
 * Conversão de lead em negócio (`convert_lead_to_deal`).
 *
 * Dono único do fluxo (achado A06): `convertForm`, `pickDeveloper` e a chamada
 * de conversão viviam copiados em `Leads.tsx` e `Pipeline.tsx`, com a versão do
 * Pipeline aceitando um documento inicial e a de Leads não. Este componente é o
 * superconjunto: o anexo é opcional, então o Pipeline adota sem perder nada.
 *
 * O documento não é exigido — a migration `0028` tirou a exigência de anexo da
 * conversão; os obrigatórios travam só o envio ao gerente.
 */
export function ConvertLeadDialog({
  lead, actorName, onClose, onConverted,
}: {
  lead: LeadRecord;
  /** Quem vira o corretor do negócio quando o lead está sem dono. */
  actorName?: string;
  onClose: () => void;
  onConverted?: () => void;
}) {
  const invalidateLeads = useInvalidateLeads();
  const fieldId = useId();
  const developers = useDevelopers(true);
  const [developerId, setDeveloperId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [unit, setUnit] = useState("");
  const [vgv, setVgv] = useState("");
  const [doc, setDocument] = useState<File | null>(null);
  const [converting, setConverting] = useState(false);
  const [reabrir, setReabrir] = useState(false);
  const projects = useDeveloperProjects(developerId);
  const developerList = developers.data ?? [];
  const projectList = projects.data ?? [];
  // Derivado na renderização: "R$ 500.000,00" vale, "1.5 mi" é recusado com
  // aviso — VGV é a base do rateio e texto inválido virava null no banco.
  const { value: vgvGross, invalid: vgvInvalid } = parseVgvInput(vgv);

  // Lead perdido ou descartado continua conversível — "perdi e voltou" acontece
  // de verdade na operação —, mas exige confirmação explícita e fica registrado
  // no histórico: converter apaga o status anterior sem deixar rastro nenhum.
  const encerrado = lead.status === "lost" || lead.status === "discarded";
  // `convert_lead_to_deal` usa `coalesce(assigned_to, auth.uid())`: quem
  // converte um lead sem corretor VIRA o corretor do negócio — e com isso entra
  // no rateio da comissão. A tela precisa dizer isso antes do clique.
  const corretorDoNegocio = lead.broker_name || actorName || "você";

  const pickDeveloper = (next: string) => {
    setDeveloperId(next);
    setProjectId("");
  };

  const submit = async () => {
    if (!developerId || vgvInvalid || (encerrado && !reabrir)) return;
    setConverting(true);
    try {
      if (doc) await uploadLeadAttachment(lead.id, doc);
      await convertLeadToDeal({
        leadId: lead.id,
        developerId,
        projectId: projectId || null,
        unit: unit || null,
        vgvGross,
      });
    } catch (err) {
      // O negócio nasce sem anexo desde a `0028`: o que costuma barrar aqui é
      // lead já convertido ou falta de permissão sobre ele.
      toast({
        variant: "destructive",
        title: "Não foi possível converter",
        description: describeError(err, "verifique os dados do negócio"),
      });
      setConverting(false);
      return;
    }

    // Daqui em diante o lead já é negócio. O comentário fica no histórico: sem
    // ele, um lead reaberto some do relatório de perdas sem explicação.
    if (encerrado) {
      try {
        await addLeadComment(
          lead.id,
          `Lead ${leadStatusLabel(lead.status).toLowerCase()} reaberto e convertido em negócio`
            + `${lead.lost_reason ? ` (motivo anterior: ${lead.lost_reason})` : ""}.`,
        );
      } catch {
        // O registro é rastro, não a operação: a conversão já aconteceu e
        // interromper aqui esconderia o negócio recém-criado.
      }
    }

    // Falha na cópia do anexo avisa, mas não desfaz nem esconde a conversão.
    try {
      await promoteLeadAttachments(lead.id);
      toast({
        title: "Lead convertido em negócio",
        description: doc
          ? `${lead.name} entrou no Pipeline com o documento anexado.`
          : `${lead.name} entrou no Pipeline, em análise inicial.`,
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Lead convertido, mas o anexo não foi copiado",
        description: describeError(err, "anexe o documento de novo na aba Anexos do negócio"),
      });
    } finally {
      setConverting(false);
    }
    await invalidateLeads();
    onConverted?.();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="glass-strong max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightCircle className="h-5 w-5 text-success" aria-hidden /> Converter em negócio
          </DialogTitle>
          <DialogDescription>
            O negócio nasce na etapa inicial da esteira. Os documentos obrigatórios são
            cobrados só no envio ao gerente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1 rounded-xl bg-muted/60 p-3 text-xs">
          <p className="text-sm font-semibold text-foreground">{lead.name}</p>
          <p className="text-muted-foreground">{lead.email || "sem e-mail"} · {lead.phone || "sem telefone"}</p>
          <p className="text-muted-foreground">Origem: {lead.source || "—"}</p>
          <p className="flex flex-wrap items-center gap-1.5 pt-0.5 text-foreground">
            <User className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
            Corretor do negócio: <span className="font-semibold">{corretorDoNegocio}</span>
            {!lead.broker_name && <span className="text-muted-foreground">(o lead está sem corretor)</span>}
          </p>
        </div>

        {encerrado && (
          <div className="space-y-2 rounded-xl border border-warning/40 bg-warning/10 p-3">
            <p className="flex items-start gap-2 text-sm text-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                Este lead está marcado como <strong>{leadStatusLabel(lead.status)}</strong>
                {lead.lost_reason ? ` (${lead.lost_reason})` : ""}. Converter reabre o atendimento e
                registra a reabertura no histórico.
              </span>
            </p>
            {/* O Checkbox do Radix é um `button` sem conteúdo textual: sem
                Label + htmlFor o leitor de tela anuncia "caixa de seleção" sem
                dizer o quê — e é esta que reabre um lead perdido. */}
            <div className="flex items-center gap-2">
              <Checkbox
                id={`${fieldId}-reabrir`}
                checked={reabrir}
                onCheckedChange={(next) => setReabrir(next === true)}
              />
              <Label htmlFor={`${fieldId}-reabrir`} className="cursor-pointer font-normal">
                Sim, reabrir e converter em negócio
              </Label>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={`${fieldId}-construtora`}>Construtora *</Label>
            <Select value={developerId} onValueChange={pickDeveloper}>
              <SelectTrigger id={`${fieldId}-construtora`}>
                {/* Sem construtora não há conversão: lista carregando e lista
                    vazia não podem parecer a mesma coisa que "escolha uma". */}
                <SelectValue placeholder={developers.isPending ? "Carregando construtoras…" : (developerList.length ? "Selecione" : "Nenhuma construtora ativa")} />
              </SelectTrigger>
              <SelectContent>
                {developerList.map((item) => (
                  <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {developers.error ? (
              <p className="text-xs text-destructive">
                {describeError(developers.error, "não foi possível listar as construtoras")}
              </p>
            ) : (!developers.isPending && developerList.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Nenhuma construtora ativa. Cadastre em Admin · Construtoras antes de converter.
              </p>
            ))}
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={`${fieldId}-empreendimento`}>Empreendimento</Label>
            <Select value={projectId} onValueChange={setProjectId} disabled={!developerId || projectList.length === 0}>
              <SelectTrigger id={`${fieldId}-empreendimento`}>
                <SelectValue placeholder={developerId ? (projectList.length ? "Opcional" : "Sem empreendimentos") : "Escolha a construtora"} />
              </SelectTrigger>
              <SelectContent>
                {projectList.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-unidade`}>Unidade</Label>
            <Input id={`${fieldId}-unidade`} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Opcional" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-vgv`}>VGV bruto</Label>
            <Input
              id={`${fieldId}-vgv`} inputMode="decimal" value={vgv}
              onChange={(e) => setVgv(e.target.value)} placeholder="Ex.: 500.000,00"
              aria-invalid={vgvInvalid || undefined}
              aria-describedby={vgvInvalid ? `${fieldId}-vgv-erro` : undefined}
            />
            {vgvInvalid && (
              <p id={`${fieldId}-vgv-erro`} className="text-xs text-destructive">
                Use apenas números no formato brasileiro, ex.: 500.000,00
              </p>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-sm font-medium">Documento inicial (opcional)</p>
          {doc ? (
            <div className="flex items-center gap-2 rounded-xl border border-success/40 bg-success/10 px-3 py-2">
              <Paperclip className="h-4 w-4 shrink-0 text-success" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm">{doc.name}</span>
              <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Remover documento" onClick={() => setDocument(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <FileDropzone
              label="Solte o documento aqui ou clique para escolher"
              // O que o bucket aceita (0056), não "qualquer arquivo": o upload
              // acontece ANTES da conversão, e um .zip fazia o formulário
              // inteiro falhar com um toast que falava do negócio.
              hint={ATTACHMENT_HINT}
              accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,.xls,.xlsx,.csv,.txt"
              onFile={(file) => {
                const recusa = rejectAttachment(file);
                if (recusa) {
                  toast({ variant: "destructive", title: "Arquivo não aceito", description: recusa });
                  return;
                }
                setDocument(file);
              }}
            />
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild><Button variant="outline" size="sm">Cancelar</Button></DialogClose>
          <Button
            size="sm"
            onClick={submit}
            disabled={!developerId || vgvInvalid || converting || (encerrado && !reabrir)}
          >
            {converting ? "Convertendo…" : "Converter"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
