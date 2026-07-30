import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { formatDistanceToNow, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  MessageCircle, Phone, Mail, Paperclip, Send, Upload,
  Clock, User, ArrowRightCircle, AlertTriangle, Download, Save, HandMetal, Timer,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import {
  listLeadEvents, listLeadComments, addLeadComment,
  listLeadAttachments, uploadLeadAttachment, signedAttachmentUrl,
  updateLead, moveLeadStage, claimLead,
  FUNNEL_STAGES, funnelStageLabel, leadStatusLabel, leadStatusClass,
  attendSecondsLeft, formatCountdown, canClaim, trackingFields,
  type LeadRecord, type LeadEvent, type LeadComment, type LeadAttachment,
  type LeadFunnelStage, type LeadPatch,
} from "@/integrations/supabase/leads";

function sourceBadgeCls(source?: string) {
  const s = (source || "").toLowerCase();
  if (s.includes("meta") || s.includes("facebook") || s.includes("instagram")) return "bg-blue-600 text-white border-blue-500";
  if (s.includes("whats")) return "bg-green-600 text-white border-green-500";
  if (s.includes("google")) return "bg-yellow-500 text-black border-yellow-400";
  if (s.includes("indica")) return "bg-purple-600 text-white border-purple-500";
  return "bg-secondary text-foreground";
}

/** Item da linha do tempo: log automático e comentário manual no mesmo lugar. */
type TimelineEntry = {
  id: string;
  at: string;
  author: string | null;
  text: string;
  manual: boolean;
};

export default function LeadDetailModal({
  lead, open, onOpenChange, actorName, onConvert, onStageChanged,
}: {
  lead: LeadRecord | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  actorName: string;
  onConvert: (l: LeadRecord) => void;
  onStageChanged?: () => void;
}) {
  const { user } = useAuth();
  const profileId = user?.id || null;

  const [events, setEvents] = useState<LeadEvent[]>([]);
  const [comments, setComments] = useState<LeadComment[]>([]);
  const [attachments, setAttachments] = useState<LeadAttachment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [sendingComment, setSendingComment] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const fileRef = useRef<HTMLInputElement>(null);

  const leadId = lead?.id;

  const loadAll = useCallback(async () => {
    if (!leadId) return;
    const [eventsResult, commentsResult, attachmentsResult] = await Promise.allSettled([
      listLeadEvents(leadId),
      listLeadComments(leadId),
      listLeadAttachments(leadId),
    ]);
    if (eventsResult.status === "fulfilled") setEvents(eventsResult.value);
    if (commentsResult.status === "fulfilled") setComments(commentsResult.value);
    if (attachmentsResult.status === "fulfilled") setAttachments(attachmentsResult.value);
  }, [leadId]);

  useEffect(() => {
    if (!leadId || !open) return;
    void loadAll();
    const channel = supabase.channel(`lead-${leadId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "lead_events", filter: `lead_id=eq.${leadId}` }, () => { void loadAll(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "lead_comments", filter: `lead_id=eq.${leadId}` }, () => { void loadAll(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "lead_attachments", filter: `lead_id=eq.${leadId}` }, () => { void loadAll(); })
      .subscribe();
    const ticker = setInterval(() => setNow(Date.now()), 1000);
    return () => { supabase.removeChannel(channel); clearInterval(ticker); };
  }, [leadId, open, loadAll]);

  // "O registro histórico deve permitir comentários manuais para manter um log
  // de toda a movimentação do lead" (ata 23/07): as duas fontes numa só linha.
  const timeline = useMemo<TimelineEntry[]>(() => {
    const fromEvents: TimelineEntry[] = events.map((event) => ({
      id: `event-${event.id}`,
      at: event.created_at,
      author: event.actor_name,
      text: event.description,
      manual: false,
    }));
    const fromComments: TimelineEntry[] = comments.map((comment) => ({
      id: `comment-${comment.id}`,
      at: comment.created_at,
      author: comment.author_name,
      text: comment.body,
      manual: true,
    }));
    return [...fromEvents, ...fromComments]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [events, comments]);

  if (!lead) return null;

  const arrived = new Date(lead.created_at);
  const lastActivity = new Date(lead.last_activity_at || lead.created_at);
  const inactiveHours = (Date.now() - lastActivity.getTime()) / 3_600_000;
  const answers: Record<string, any> = lead.form_answers || {};
  const digits = (lead.phone || "").replace(/\D/g, "");
  const waLink = digits
    ? `https://wa.me/${digits.startsWith("55") ? digits : `55${digits}`}?text=${encodeURIComponent(`Olá ${lead.name}, tudo bem?`)}`
    : "";
  const secondsLeft = attendSecondsLeft(lead, now);
  const claimable = canClaim(lead, profileId);
  const tracking = trackingFields(lead);

  const attend = async () => {
    try {
      await claimLead(lead.id);
      toast({ title: "Lead em atendimento", description: "O cronômetro parou: o lead é seu." });
      onStageChanged?.();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Não foi possível atender",
        description: err instanceof Error ? err.message : "tente novamente",
      });
      onStageChanged?.();
    }
  };

  const moveTo = async (stage: LeadFunnelStage) => {
    try {
      await moveLeadStage(lead.id, stage);
      toast({ title: `Movido para ${funnelStageLabel(stage)}` });
      onStageChanged?.();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erro ao mover",
        description: err instanceof Error ? err.message : "sem permissão para este lead",
      });
    }
  };

  const touchFirstContact = async () => {
    if (lead.funnel_stage !== "new") return;
    try {
      await moveLeadStage(lead.id, "first_contact");
      onStageChanged?.();
    } catch {
      // Contato registrado por gesto do usuário: falhar aqui não deve
      // interromper a ação (ligar, mandar WhatsApp) que ele acabou de fazer.
    }
  };

  const submitComment = async () => {
    if (!newComment.trim()) return;
    setSendingComment(true);
    try {
      await addLeadComment(lead.id, newComment);
      setNewComment("");
      await touchFirstContact();
      await loadAll();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erro ao comentar",
        description: err instanceof Error ? err.message : "tente novamente",
      });
    } finally {
      setSendingComment(false);
    }
  };

  const upload = async (file: File) => {
    setUploading(true);
    try {
      await uploadLeadAttachment(lead.id, file);
      toast({ title: "Anexo enviado" });
      await touchFirstContact();
      await loadAll();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erro no upload",
        description: err instanceof Error ? err.message : "tente novamente",
      });
    } finally {
      setUploading(false);
    }
  };

  const download = async (attachment: LeadAttachment) => {
    try {
      window.open(await signedAttachmentUrl(attachment.storage_path), "_blank");
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erro ao baixar",
        description: err instanceof Error ? err.message : "link não gerado",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl glass-strong max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 flex-wrap">
            <span>{lead.name}</span>
            <Badge className={leadStatusClass(lead.status)}>{leadStatusLabel(lead.status)}</Badge>
            <Badge variant="outline">{funnelStageLabel(lead.funnel_stage)}</Badge>
            {secondsLeft !== null && (
              <Badge className={cn("gap-1", secondsLeft <= 60 ? "bg-destructive text-destructive-foreground" : "bg-warning/20 text-warning")}>
                <Timer className="h-3 w-3" /> {formatCountdown(secondsLeft)} para atender
              </Badge>
            )}
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
            {lead.campaign_name && <Badge variant="outline" className="text-[10px]">📣 {lead.campaign_name}</Badge>}
            {lead.form_name && <Badge variant="outline" className="text-[10px]">📋 {lead.form_name}</Badge>}
          </p>
        </DialogHeader>

        {/* Ações rápidas */}
        <div className="flex flex-wrap gap-2">
          {claimable && (
            <Button size="sm" onClick={attend} className="gap-1">
              <HandMetal className="h-4 w-4" /> Atender
              {secondsLeft !== null && <span className="font-mono">{formatCountdown(secondsLeft)}</span>}
            </Button>
          )}
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
          {lead.status !== "converted" && !lead.converted_deal_id && (
            <Button size="sm" variant="default" className="ml-auto" onClick={() => onConvert(lead)}>
              <ArrowRightCircle className="h-4 w-4 mr-1" /> Converter
            </Button>
          )}
        </div>

        {/* Mover de etapa */}
        <div className="flex flex-wrap gap-1">
          {FUNNEL_STAGES.map((stage) => (
            <Button
              key={stage.key} size="sm"
              variant={lead.funnel_stage === stage.key ? "default" : "outline"}
              className="text-[11px] h-7 px-2"
              onClick={() => moveTo(stage.key)}
            >
              {stage.label}
            </Button>
          ))}
        </div>

        <Tabs defaultValue="info" className="mt-2">
          <TabsList className="grid grid-cols-6 w-full">
            <TabsTrigger value="info" className="text-[11px]">Dados</TabsTrigger>
            <TabsTrigger value="form" className="text-[11px]">Formulário</TabsTrigger>
            <TabsTrigger value="comments" className="text-[11px]">Comentar</TabsTrigger>
            <TabsTrigger value="attachments" className="text-[11px]">Anexos</TabsTrigger>
            <TabsTrigger value="history" className="text-[11px]">Histórico</TabsTrigger>
            <TabsTrigger value="tracking" className="text-[11px]">Rastreio</TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="space-y-3">
            <div className="space-y-2 text-sm">
              <Row k="Origem" v={lead.source} />
              <Row k="Corretor" v={lead.broker_name} />
              <Row k="Atribuído em" v={lead.assigned_at ? format(new Date(lead.assigned_at), "dd/MM/yyyy HH:mm") : null} />
              <Row k="Primeiro contato" v={lead.first_contact_at ? format(new Date(lead.first_contact_at), "dd/MM/yyyy HH:mm") : null} />
              <Row k="Próxima ação" v={lead.next_action_at ? format(new Date(lead.next_action_at), "dd/MM/yyyy HH:mm") : null} />
              <Row k="Qualificado pela IA" v={lead.sdr_qualified_at ? format(new Date(lead.sdr_qualified_at), "dd/MM/yyyy HH:mm") : null} />
              <Row k="Notas" v={lead.notes} />
            </div>
            <EditFields
              lead={lead}
              onSaved={() => onStageChanged?.()}
              fields={[
                { k: "full_name", label: "Nome" },
                { k: "phone", label: "Telefone / WhatsApp" },
                { k: "email", label: "E-mail", type: "email" },
                { k: "document", label: "CPF / documento" },
              ]}
            />
          </TabsContent>

          <TabsContent value="form">
            {Object.keys(answers).length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem respostas de formulário.</p>
            ) : (
              <div className="space-y-2">
                {lead.form_name && <p className="text-xs text-muted-foreground">Formulário: <span className="font-medium">{lead.form_name}</span></p>}
                {Object.entries(answers).map(([k, v]) => <Row key={k} k={k} v={String(v)} />)}
              </div>
            )}
          </TabsContent>

          <TabsContent value="comments" className="space-y-3">
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {comments.map((comment) => (
                <div key={comment.id} className="p-2 rounded-lg bg-secondary/40 border border-border/40">
                  <p className="text-xs text-muted-foreground">
                    {comment.author_name} • {format(new Date(comment.created_at), "dd/MM HH:mm")}
                  </p>
                  <p className="text-sm mt-0.5 whitespace-pre-wrap">{comment.body}</p>
                </div>
              ))}
              {comments.length === 0 && <p className="text-sm text-muted-foreground">Nenhum comentário ainda.</p>}
            </div>
            <div className="flex gap-2">
              <Textarea rows={2} value={newComment} onChange={(e) => setNewComment(e.target.value)} placeholder={`Comentar como ${actorName}...`} />
              <Button onClick={submitComment} disabled={!newComment.trim() || sendingComment} className="self-end">
                <Send className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              O comentário entra no histórico do lead junto com o log automático.
            </p>
          </TabsContent>

          <TabsContent value="attachments" className="space-y-3">
            <input ref={fileRef} type="file" className="hidden" onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
              e.currentTarget.value = "";
            }} />
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
              <Upload className="h-4 w-4 mr-1" /> {uploading ? "Enviando..." : "Anexar arquivo"}
            </Button>
            <div className="space-y-2">
              {attachments.map((attachment) => (
                <div key={attachment.id} className="flex items-center justify-between p-2 rounded-lg bg-secondary/40 border border-border/40">
                  <div className="flex items-center gap-2 min-w-0">
                    <Paperclip className="h-4 w-4 shrink-0" />
                    <span className="text-sm truncate">{attachment.original_name}</span>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => download(attachment)}>
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              {attachments.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Sem anexos. A conversão em negócio exige pelo menos um documento.
                </p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="history">
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {timeline.map((entry) => (
                <div
                  key={entry.id}
                  className={cn(
                    "flex gap-3 items-start p-2 rounded-lg border",
                    entry.manual ? "border-primary/30 bg-primary/5" : "border-border/30",
                  )}
                >
                  <div className={cn("w-2 h-2 rounded-full mt-1.5 shrink-0", entry.manual ? "bg-primary" : "bg-muted-foreground/50")} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(entry.at), "dd/MM HH:mm")}
                      {entry.author ? ` • ${entry.author}` : ""}
                      {entry.manual ? " • comentário" : ""}
                    </p>
                    <p className="text-sm whitespace-pre-wrap">{entry.text}</p>
                  </div>
                </div>
              ))}
              {timeline.length === 0 && <p className="text-sm text-muted-foreground">Sem histórico.</p>}
            </div>
          </TabsContent>

          <TabsContent value="tracking" className="space-y-2 text-sm">
            {tracking.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem dados de rastreio.</p>
            ) : (
              tracking.map((field) => <Row key={field.label} k={field.label} v={field.value} />)
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function EditFields({
  lead, fields, onSaved,
}: {
  lead: LeadRecord;
  fields: { k: keyof LeadPatch & string; label: string; type?: string }[];
  onSaved?: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    fields.forEach((field) => { initial[field.k] = (lead as any)[field.k] ?? ""; });
    return initial;
  });
  const [saving, setSaving] = useState(false);

  // O lead muda por baixo (roleta, realtime): reflete o registro atual.
  useEffect(() => {
    const next: Record<string, string> = {};
    fields.forEach((field) => { next[field.k] = (lead as any)[field.k] ?? ""; });
    setValues(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id, lead.updated_at]);

  const save = async () => {
    setSaving(true);
    try {
      const patch: LeadPatch = {};
      fields.forEach((field) => {
        (patch as any)[field.k] = values[field.k]?.trim() || null;
      });
      // `full_name` é `not null` no banco: não deixa apagar pela tela.
      if (patch.full_name === null) delete patch.full_name;
      await updateLead(lead.id, patch);
      toast({ title: "Dados salvos" });
      onSaved?.();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erro ao salvar",
        description: err instanceof Error ? err.message : "sem permissão para este lead",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 border-t border-border/40 pt-3">
      {fields.map((field) => (
        <div key={field.k} className="space-y-1">
          <Label className="text-xs">{field.label}</Label>
          <Input
            type={field.type || "text"}
            value={values[field.k] || ""}
            onChange={(e) => setValues((prev) => ({ ...prev, [field.k]: e.target.value }))}
          />
        </div>
      ))}
      <Button size="sm" onClick={save} disabled={saving}>
        <Save className="h-3 w-3 mr-1" /> {saving ? "Salvando..." : "Salvar"}
      </Button>
    </div>
  );
}

function Row({ k, v }: { k: string; v?: string | null }) {
  if (!v) return null;
  return (
    <div className="flex gap-2 text-sm">
      <span className="text-muted-foreground min-w-[130px] capitalize">{k.replace(/_/g, " ")}:</span>
      <span className="flex-1 break-all">{v}</span>
    </div>
  );
}
