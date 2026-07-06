import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { formatDistanceToNow, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  MessageCircle, Phone, Mail, Paperclip, Send, Upload,
  Clock, User, ArrowRightCircle, AlertTriangle, Download, X, Save,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

type LeadRow = any;

const stageLabels: Record<string, string> = {
  new: "Novo Lead",
  first_contact: "Primeiro Contato",
  no_response: "Sem Resposta",
  warm: "Lead Morno",
  hot: "Lead Quente",
  gathering_docs: "Juntando Doc",
  converted: "Convertido",
};

function sourceBadgeCls(source?: string) {
  const s = (source || "").toLowerCase();
  if (s.includes("meta") || s.includes("facebook") || s.includes("instagram")) return "bg-blue-600 text-white border-blue-500";
  if (s.includes("whats")) return "bg-green-600 text-white border-green-500";
  if (s.includes("google")) return "bg-yellow-500 text-black border-yellow-400";
  if (s.includes("indica")) return "bg-purple-600 text-white border-purple-500";
  return "bg-secondary text-foreground";
}

export default function LeadDetailModal({
  lead, open, onOpenChange, actorName, onConvert, onStageChanged,
}: {
  lead: LeadRow | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  actorName: string;
  onConvert: (l: LeadRow) => void;
  onStageChanged?: () => void;
}) {
  const [history, setHistory] = useState<any[]>([]);
  const [comments, setComments] = useState<any[]>([]);
  const [attachments, setAttachments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!lead?.id || !open) return;
    const loadAll = async () => {
      const [h, c, a] = await Promise.all([
        supabase.from("lead_history").select("*").eq("lead_id", lead.id).order("created_at", { ascending: false }),
        supabase.from("lead_comments").select("*").eq("lead_id", lead.id).order("created_at", { ascending: true }),
        supabase.from("lead_attachments").select("*").eq("lead_id", lead.id).order("created_at", { ascending: false }),
      ]);
      setHistory(h.data || []);
      setComments(c.data || []);
      setAttachments(a.data || []);
    };
    loadAll();
    const ch = supabase.channel(`lead-${lead.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "lead_history", filter: `lead_id=eq.${lead.id}` }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "lead_comments", filter: `lead_id=eq.${lead.id}` }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "lead_attachments", filter: `lead_id=eq.${lead.id}` }, loadAll)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [lead?.id, open]);

  if (!lead) return null;

  const arrived = new Date(lead.created_at);
  const lastAct = new Date(lead.last_activity_at || lead.created_at);
  const inactiveHours = (Date.now() - lastAct.getTime()) / 3_600_000;
  const answers: Record<string, string> = lead.form_answers || {};
  const whatsappNum = (lead.whatsapp || lead.phone || "").replace(/\D/g, "");
  const waLink = whatsappNum
    ? `https://wa.me/${whatsappNum.startsWith("55") ? whatsappNum : "55" + whatsappNum}?text=${encodeURIComponent(`Olá ${lead.name || ""}, tudo bem?`)}`
    : "";

  const moveTo = async (stage: string) => {
    const patch: any = { funnel_stage: stage };
    if (stage === "first_contact") patch.first_contact_at = new Date().toISOString();
    const { error } = await supabase.from("leads").update(patch).eq("id", lead.id);
    if (error) { toast({ variant: "destructive", title: "Erro", description: error.message }); return; }
    toast({ title: `Movido para ${stageLabels[stage]}` });
    onStageChanged?.();
  };

  const touchFirstContact = async () => {
    if (lead.funnel_stage === "new") await moveTo("first_contact");
  };

  const addComment = async () => {
    if (!newComment.trim()) return;
    const { error } = await supabase.from("lead_comments").insert({
      lead_id: lead.id, author_name: actorName || "Sistema", message: newComment.trim(),
    });
    if (error) { toast({ variant: "destructive", title: "Erro", description: error.message }); return; }
    await supabase.from("lead_history").insert({
      lead_id: lead.id, event_type: "comment", description: `Comentário: ${newComment.trim().slice(0, 60)}`, actor_name: actorName,
    });
    setNewComment("");
    await touchFirstContact();
  };

  const uploadFile = async (f: File) => {
    const path = `${lead.id}/${Date.now()}-${f.name}`;
    const { error: upErr } = await supabase.storage.from("lead-attachments").upload(path, f);
    if (upErr) { toast({ variant: "destructive", title: "Erro no upload", description: upErr.message }); return; }
    const { error } = await supabase.from("lead_attachments").insert({
      lead_id: lead.id, file_path: path, file_name: f.name, mime: f.type, size: f.size,
    });
    if (error) { toast({ variant: "destructive", title: "Erro", description: error.message }); return; }
    await supabase.from("lead_history").insert({
      lead_id: lead.id, event_type: "attachment", description: `Anexo adicionado: ${f.name}`, actor_name: actorName,
    });
    toast({ title: "Anexo enviado" });
    await touchFirstContact();
  };

  const downloadAtt = async (a: any) => {
    const { data, error } = await supabase.storage.from("lead-attachments").createSignedUrl(a.file_path, 60);
    if (error || !data) { toast({ variant: "destructive", title: "Erro", description: error?.message || "" }); return; }
    window.open(data.signedUrl, "_blank");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl glass-strong max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 flex-wrap">
            <span>{lead.name || "Sem nome"}</span>
            <Badge variant="outline">{stageLabels[lead.funnel_stage] || lead.funnel_stage}</Badge>
            {inactiveHours > 24 && (
              <Badge className="bg-destructive text-destructive-foreground gap-1">
                <AlertTriangle className="h-3 w-3" /> Inativo há {inactiveHours.toFixed(0)}h
              </Badge>
            )}
          </DialogTitle>
          <p className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap pt-1">
            <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> Chegou {formatDistanceToNow(arrived, { locale: ptBR, addSuffix: true })}</span>
            <span className="flex items-center gap-1"><User className="h-3 w-3" /> {lead.broker_name || "Sem corretor"}</span>
            <Badge className={cn("border text-[10px]", sourceBadgeCls(lead.source))}>{lead.source || "Origem —"}</Badge>
            {lead.form_name && (
              <Badge variant="outline" className="text-[10px]">📋 {lead.form_name}</Badge>
            )}
          </p>
        </DialogHeader>

        {/* Ações rápidas */}
        <div className="flex flex-wrap gap-2">
          {waLink && (
            <Button size="sm" className="bg-green-600 hover:bg-green-700" asChild onClick={touchFirstContact}>
              <a href={waLink} target="_blank" rel="noreferrer"><MessageCircle className="h-4 w-4 mr-1" /> WhatsApp</a>
            </Button>
          )}
          {lead.phone && (
            <Button size="sm" variant="outline" asChild onClick={touchFirstContact}>
              <a href={`tel:${lead.phone}`}><Phone className="h-4 w-4 mr-1" /> Ligar</a>
            </Button>
          )}
          {lead.email && (
            <Button size="sm" variant="outline" asChild>
              <a href={`mailto:${lead.email}`}><Mail className="h-4 w-4 mr-1" /> E-mail</a>
            </Button>
          )}
          {lead.funnel_stage !== "converted" && (
            <Button size="sm" variant="default" className="ml-auto" onClick={() => onConvert(lead)}>
              <ArrowRightCircle className="h-4 w-4 mr-1" /> Converter
            </Button>
          )}
        </div>

        {/* Mover para estágio */}
        <div className="flex flex-wrap gap-1">
          {Object.entries(stageLabels).filter(([k]) => k !== "converted").map(([k, l]) => (
            <Button key={k} size="sm" variant={lead.funnel_stage === k ? "default" : "outline"}
              className="text-[11px] h-7 px-2" onClick={() => moveTo(k)}>{l}</Button>
          ))}
        </div>

        <Tabs defaultValue="info" className="mt-2">
          <TabsList className="grid grid-cols-7 w-full">
            <TabsTrigger value="info">Dados</TabsTrigger>
            <TabsTrigger value="personal">Pessoal</TabsTrigger>
            <TabsTrigger value="interest">Interesse</TabsTrigger>
            <TabsTrigger value="form">Form</TabsTrigger>
            <TabsTrigger value="comments">Coment. ({comments.length})</TabsTrigger>
            <TabsTrigger value="attachments">Anexos ({attachments.length})</TabsTrigger>
            <TabsTrigger value="tracking">Rastreio</TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="space-y-2 text-sm">
            <Row k="Nome" v={lead.name} />
            <Row k="Telefone" v={lead.phone} />
            <Row k="WhatsApp" v={lead.whatsapp} />
            <Row k="E-mail" v={lead.email} />
            <Row k="Origem" v={lead.source} />
            <Row k="Formulário" v={lead.form_name} />
            <Row k="Corretor" v={lead.broker_name} />
            {lead.notes && <Row k="Notas" v={lead.notes} />}
          </TabsContent>

          <TabsContent value="personal" className="space-y-2">
            <EditFields lead={lead} fields={[
              { k: "cpf", label: "CPF" },
              { k: "birth_date", label: "Data de nascimento", type: "date" },
              { k: "address", label: "Endereço" },
              { k: "phone", label: "Telefone" },
              { k: "whatsapp", label: "WhatsApp" },
              { k: "email", label: "E-mail", type: "email" },
            ]} />
          </TabsContent>

          <TabsContent value="interest" className="space-y-2">
            <EditFields lead={lead} fields={[
              { k: "developer", label: "Construtora" },
              { k: "development", label: "Empreendimento" },
              { k: "unit", label: "Unidade" },
            ]} />
          </TabsContent>

          <TabsContent value="form">
            {Object.keys(answers).length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem respostas de formulário.</p>
            ) : (
              <div className="space-y-2">
                {lead.form_name && <p className="text-xs text-muted-foreground">Formulário: <span className="font-medium">{lead.form_name}</span></p>}
                {Object.entries(answers).map(([k, v]) => (
                  <Row key={k} k={k} v={String(v)} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="comments" className="space-y-3">
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {comments.map(c => (
                <div key={c.id} className="p-2 rounded-lg bg-secondary/40 border border-border/40">
                  <p className="text-xs text-muted-foreground">{c.author_name} • {format(new Date(c.created_at), "dd/MM HH:mm")}</p>
                  <p className="text-sm mt-0.5 whitespace-pre-wrap">{c.message}</p>
                </div>
              ))}
              {comments.length === 0 && <p className="text-sm text-muted-foreground">Nenhum comentário ainda.</p>}
            </div>
            <div className="flex gap-2">
              <Textarea rows={2} value={newComment} onChange={e => setNewComment(e.target.value)} placeholder="Escrever comentário..." />
              <Button onClick={addComment} className="self-end"><Send className="h-4 w-4" /></Button>
            </div>
          </TabsContent>

          <TabsContent value="attachments" className="space-y-3">
            <input ref={fileRef} type="file" className="hidden" onChange={e => {
              const f = e.target.files?.[0]; if (f) uploadFile(f);
              e.currentTarget.value = "";
            }} />
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4 mr-1" /> Anexar arquivo
            </Button>
            <div className="space-y-2">
              {attachments.map(a => (
                <div key={a.id} className="flex items-center justify-between p-2 rounded-lg bg-secondary/40 border border-border/40">
                  <div className="flex items-center gap-2 min-w-0">
                    <Paperclip className="h-4 w-4 shrink-0" />
                    <span className="text-sm truncate">{a.file_name}</span>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => downloadAtt(a)}>
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              {attachments.length === 0 && <p className="text-sm text-muted-foreground">Sem anexos.</p>}
            </div>
          </TabsContent>

          <TabsContent value="history">
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {history.map(h => (
                <div key={h.id} className="flex gap-3 items-start p-2 rounded-lg border border-border/30">
                  <div className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-muted-foreground">{format(new Date(h.created_at), "dd/MM HH:mm")} {h.actor_name ? `• ${h.actor_name}` : ""}</p>
                    <p className="text-sm">{h.description}</p>
                  </div>
                </div>
              ))}
              {history.length === 0 && <p className="text-sm text-muted-foreground">Sem histórico.</p>}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function Row({ k, v }: { k: string; v?: string }) {
  if (!v) return null;
  return (
    <div className="flex gap-2 text-sm">
      <span className="text-muted-foreground min-w-[110px] capitalize">{k.replace(/_/g, " ")}:</span>
      <span className="flex-1 break-all">{v}</span>
    </div>
  );
}
