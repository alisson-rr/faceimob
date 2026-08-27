import { useId, useState } from "react";
import { Mail, MessageCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { emailTemplates, renderTemplate } from "@/lib/automationEngine";
import type { LeadRecord, WhatsappTemplate } from "@/integrations/supabase/leads";
import { waNumber } from "./model";

/** Abre o WhatsApp Web com a mensagem pronta — o envio é no aplicativo. */
export function WhatsAppDialog({
  lead, templates, onClose,
}: {
  lead: LeadRecord;
  templates: WhatsappTemplate[];
  onClose: () => void;
}) {
  const fieldId = useId();
  const [templateId, setTemplateId] = useState("");
  const [message, setMessage] = useState("");

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const template = templates.find((item) => item.id === id);
    if (!template) return;
    setMessage(renderTemplate(template.body, {
      client_name: lead.name,
      broker_name: lead.broker_name || "Faceimob",
      project: "Nossos empreendimentos",
      visit_date: "",
      visit_time: "",
      address: "",
    }));
  };

  const send = () => {
    const number = waNumber(lead.phone);
    if (!number) {
      toast({ variant: "destructive", title: "Lead sem telefone", description: "Cadastre o telefone antes de mandar WhatsApp." });
      return;
    }
    window.open(`https://wa.me/${number}?text=${encodeURIComponent(message)}`, "_blank", "noopener");
    toast({ title: "WhatsApp aberto", description: `Mensagem preparada para ${lead.name}.` });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="glass-strong max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-success" aria-hidden /> WhatsApp para {lead.name}
          </DialogTitle>
          <DialogDescription>A mensagem abre no WhatsApp; o envio continua sendo seu.</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor={fieldId}>Template</Label>
          {templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum template cadastrado. Cadastre os templates ativos no módulo SDR IA (aba WhatsApp).
            </p>
          ) : (
            <Select value={templateId} onValueChange={applyTemplate}>
              <SelectTrigger id={fieldId}><SelectValue placeholder="Selecione um template" /></SelectTrigger>
              <SelectContent>
                {templates.map((template) => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-msg`}>Mensagem</Label>
          <Textarea
            id={`${fieldId}-msg`} rows={6} value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Escreva ou selecione um template…"
          />
        </div>

        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
          <Button onClick={send} disabled={!message.trim()}>
            <Send className="h-4 w-4" /> Abrir WhatsApp
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Monta o `mailto:` a partir dos templates de e-mail da automação. */
export function EmailDialog({ lead, onClose }: { lead: LeadRecord; onClose: () => void }) {
  const fieldId = useId();
  const [templateId, setTemplateId] = useState("");
  const template = emailTemplates.find((item) => item.id === templateId);

  const send = () => {
    if (!template) return;
    const vars = {
      client_name: lead.name,
      project: "",
      broker_name: lead.broker_name || "Faceimob",
      unit: "",
      visit_date: "",
    };
    const subject = encodeURIComponent(renderTemplate(template.subject, vars));
    const body = encodeURIComponent(renderTemplate(template.body, vars));
    window.open(`mailto:${lead.email || ""}?subject=${subject}&body=${body}`);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="glass-strong max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" aria-hidden /> E-mail para {lead.name}
          </DialogTitle>
          <DialogDescription>{lead.email || "Este lead não tem e-mail cadastrado."}</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor={fieldId}>Template</Label>
          <Select value={templateId} onValueChange={setTemplateId}>
            <SelectTrigger id={fieldId}><SelectValue placeholder="Selecione um template" /></SelectTrigger>
            <SelectContent>
              {emailTemplates.map((item) => (
                <SelectItem key={item.id} value={item.id}>{item.name} — {item.subject}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {template && (
          <div className="space-y-2 rounded-xl bg-muted/60 p-3 text-xs">
            <p className="text-sm font-semibold text-foreground">Assunto: {template.subject}</p>
            <p className="whitespace-pre-line text-muted-foreground">{template.body}</p>
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
          <Button onClick={send} disabled={!template || !lead.email}>
            <Send className="h-4 w-4" /> Abrir e-mail
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
