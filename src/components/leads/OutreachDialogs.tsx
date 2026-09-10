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
import { fillWhatsappTemplate, waNumber } from "./model";

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
    const broker = lead.broker_name || "Faceimob";
    // Passe nomeado (templates da automação) e depois o posicional da tabela
    // `whatsapp_templates`, que é o que chega aqui do módulo SDR.
    //
    // Só o que se sabe do lead entra. `renderTemplate` troca apenas as chaves
    // recebidas, então `{{project}}`, `{{visit_date}}` e companhia continuam
    // visíveis para o corretor completar no textarea — mandar string vazia
    // produziria "Sua visita ao  está confirmada para .". Mesma regra do
    // posicional `{{n}}` (ver `fillWhatsappTemplate`).
    const named = renderTemplate(template.body, {
      client_name: lead.name,
      broker_name: broker,
    });
    setMessage(fillWhatsappTemplate(named, template.variables, {
      nome: lead.name,
      cliente: lead.name,
      corretor: broker,
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
  // Só o nome do cliente e o do corretor saem do lead. `{{project}}`,
  // `{{unit}}` e `{{visit_date}}` ficam visíveis no rascunho — com string vazia
  // o cliente receberia "Visita Confirmada - " e "está confirmada para .".
  const vars = { client_name: lead.name, broker_name: lead.broker_name || "Faceimob" };
  const subject = template ? renderTemplate(template.subject, vars) : "";
  const body = template ? renderTemplate(template.body, vars) : "";

  const send = () => {
    if (!template) return;
    window.open(
      `mailto:${lead.email || ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
    );
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
          // Pré-visualização do que vai ser enviado, não do template cru: as
          // chaves que sobram são as que o corretor precisa completar no e-mail.
          <div className="space-y-2 rounded-xl bg-muted/60 p-3 text-xs">
            <p className="text-sm font-semibold text-foreground">Assunto: {subject}</p>
            <p className="whitespace-pre-line text-muted-foreground">{body}</p>
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
