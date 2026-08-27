import { useId, useState } from "react";
import { ArrowRightCircle, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { describeError } from "@/lib/supabaseError";
import { convertLeadToDeal, uploadLeadAttachment, type LeadRecord } from "@/integrations/supabase/leads";
import { useDeveloperProjects, useDevelopers, useInvalidateLeads } from "./data";
import { FileDropzone } from "./FileDropzone";

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
  lead, onClose, onConverted,
}: {
  lead: LeadRecord;
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
  const projects = useDeveloperProjects(developerId);
  const projectList = projects.data ?? [];

  const pickDeveloper = (next: string) => {
    setDeveloperId(next);
    setProjectId("");
  };

  const submit = async () => {
    if (!developerId) return;
    setConverting(true);
    try {
      if (doc) await uploadLeadAttachment(lead.id, doc);
      await convertLeadToDeal({
        leadId: lead.id,
        developerId,
        projectId: projectId || null,
        unit: unit || null,
        vgvGross: vgv ? Number(vgv.replace(/\./g, "").replace(",", ".")) : null,
      });
      toast({
        title: "Lead convertido em negócio",
        description: doc
          ? `${lead.name} entrou no Pipeline com o documento anexado.`
          : `${lead.name} entrou no Pipeline, em análise inicial.`,
      });
      await invalidateLeads();
      onConverted?.();
      onClose();
    } catch (err) {
      // O negócio nasce sem anexo desde a `0028`: o que costuma barrar aqui é
      // lead já convertido ou falta de permissão sobre ele.
      toast({
        variant: "destructive",
        title: "Não foi possível converter",
        description: describeError(err, "verifique os dados do negócio"),
      });
    } finally {
      setConverting(false);
    }
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
          <p className="text-muted-foreground">Origem: {lead.source || "—"} · Corretor: {lead.broker_name || "—"}</p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={`${fieldId}-construtora`}>Construtora *</Label>
            <Select value={developerId} onValueChange={pickDeveloper}>
              <SelectTrigger id={`${fieldId}-construtora`}>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {(developers.data ?? []).map((item) => (
                  <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {developers.error && (
              <p className="text-xs text-destructive">
                {describeError(developers.error, "não foi possível listar as construtoras")}
              </p>
            )}
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
            <Input id={`${fieldId}-vgv`} inputMode="decimal" value={vgv} onChange={(e) => setVgv(e.target.value)} placeholder="Opcional" />
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
              hint="PDF, imagem ou qualquer arquivo"
              onFile={setDocument}
            />
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild><Button variant="outline" size="sm">Cancelar</Button></DialogClose>
          <Button size="sm" onClick={submit} disabled={!developerId || converting}>
            {converting ? "Convertendo…" : "Converter"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
