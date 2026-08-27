import { useId, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/shared";
import { useLeadDetail, useNowTicker } from "@/components/leads";
import { useAuth } from "@/contexts/AuthContext";
import TaskPanel from "@/components/TaskPanel";
import VisitPanel from "@/components/VisitPanel";
import { toast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertTriangle, ArrowRightCircle, Clock, Download, HandMetal, Mail,
  MessageCircle, Paperclip, Phone, Save, Send, Timer, Upload, User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { dateTime } from "@/lib/format";
import { describeError } from "@/lib/supabaseError";
import {
  addLeadComment, uploadLeadAttachment, signedAttachmentUrl,
  updateLead, moveLeadStage, claimLead,
  FUNNEL_STAGES, funnelStageLabel, funnelStageTone, leadSourceTone, leadStatusLabel, leadStatusTone,
  attendSecondsLeft, formatCountdown, canClaim, trackingFields,
  type LeadRecord, type LeadAttachment,
  type LeadFunnelStage, type LeadPatch,
} from "@/integrations/supabase/leads";

type EditableField = "full_name" | "phone" | "email" | "document";

/** Item da linha do tempo: log automático e comentário manual no mesmo lugar. */
type TimelineEntry = {
  id: string;
  at: string;
  author: string | null;
  text: string;
  manual: boolean;
};

const EDIT_FIELDS: { key: EditableField; label: string; type?: string }[] = [
  { key: "full_name", label: "Nome" },
  { key: "phone", label: "Telefone / WhatsApp" },
  { key: "email", label: "E-mail", type: "email" },
  { key: "document", label: "CPF / documento" },
];

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

  const [newComment, setNewComment] = useState("");
  const [sendingComment, setSendingComment] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const commentId = useId();

  const { events, comments, attachments, reload } = useLeadDetail(lead?.id, open);
  // Cronômetro da trava: só vale a pena o tique de 1s com o modal aberto.
  const now = useNowTicker(open);

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
  const answers: Record<string, unknown> = lead.form_answers || {};
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
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Não foi possível atender",
        description: describeError(err, "outro corretor pode ter assumido antes"),
      });
    }
    onStageChanged?.();
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
        description: describeError(err, "sem permissão para este lead"),
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
      await reload();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erro ao comentar",
        description: describeError(err, "tente novamente"),
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
      await reload();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erro no upload",
        description: describeError(err, "tente novamente"),
      });
    } finally {
      setUploading(false);
    }
  };

  const download = async (attachment: LeadAttachment) => {
    try {
      window.open(await signedAttachmentUrl(attachment.storage_path), "_blank", "noopener");
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erro ao baixar",
        description: describeError(err, "link não gerado"),
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-strong max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span>{lead.name}</span>
            <StatusBadge tone={leadStatusTone(lead.status)}>{leadStatusLabel(lead.status)}</StatusBadge>
            <StatusBadge tone={funnelStageTone(lead.funnel_stage)}>{funnelStageLabel(lead.funnel_stage)}</StatusBadge>
            {secondsLeft !== null && (
              <StatusBadge tone={secondsLeft <= 60 ? "danger" : "warning"} icon={Timer}>
                <span className="tabular-nums">{formatCountdown(secondsLeft)}</span> para atender
              </StatusBadge>
            )}
            {inactiveHours > 24 && (
              <StatusBadge tone="danger" icon={AlertTriangle}>Inativo há {inactiveHours.toFixed(0)}h</StatusBadge>
            )}
          </DialogTitle>
          <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" aria-hidden /> Chegou {formatDistanceToNow(arrived, { locale: ptBR, addSuffix: true })}
            </span>
            <span className="flex items-center gap-1">
              <User className="h-3.5 w-3.5" aria-hidden /> {lead.broker_name || "Sem corretor"}
            </span>
            <StatusBadge tone={leadSourceTone(lead.source)}>{lead.source || "Origem —"}</StatusBadge>
            {lead.campaign_name && <StatusBadge tone="neutral">📣 {lead.campaign_name}</StatusBadge>}
            {lead.form_name && <StatusBadge tone="neutral">📋 {lead.form_name}</StatusBadge>}
          </div>
        </DialogHeader>

        {/* Ações rápidas */}
        <div className="flex flex-wrap gap-2">
          {claimable && (
            <Button size="sm" onClick={attend}>
              <HandMetal className="h-4 w-4" /> Atender
              {secondsLeft !== null && <span className="tabular-nums">{formatCountdown(secondsLeft)}</span>}
            </Button>
          )}
          {waLink && (
            <Button size="sm" variant="outline" className="border-success/40 text-success hover:text-success" asChild onClick={touchFirstContact}>
              <a href={waLink} target="_blank" rel="noreferrer"><MessageCircle className="h-4 w-4" /> WhatsApp</a>
            </Button>
          )}
          {lead.phone && (
            <Button size="sm" variant="outline" asChild onClick={touchFirstContact}>
              <a href={`tel:${lead.phone}`}><Phone className="h-4 w-4" /> Ligar</a>
            </Button>
          )}
          {lead.email && (
            <Button size="sm" variant="outline" asChild>
              <a href={`mailto:${lead.email}`}><Mail className="h-4 w-4" /> E-mail</a>
            </Button>
          )}
          {lead.status !== "converted" && !lead.converted_deal_id && (
            <Button size="sm" className="sm:ml-auto" onClick={() => onConvert(lead)}>
              <ArrowRightCircle className="h-4 w-4" /> Converter
            </Button>
          )}
        </div>

        {/* Mover de etapa */}
        <div className="flex flex-wrap gap-1">
          {FUNNEL_STAGES.map((stage) => (
            <Button
              key={stage.key} size="sm"
              variant={lead.funnel_stage === stage.key ? "default" : "outline"}
              className="h-8 px-3 text-xs"
              onClick={() => moveTo(stage.key)}
            >
              {stage.label}
            </Button>
          ))}
        </div>

        <Tabs defaultValue="info" className="mt-2">
          {/* 7 abas: `grid-cols-6` escondia a última e o `h-10` do TabsList
              cortava o rótulo. Em tela estreita quebra em duas linhas. */}
          <TabsList className="grid h-auto w-full grid-cols-4 sm:grid-cols-7">
            <TabsTrigger value="info" className="text-xs">Dados</TabsTrigger>
            <TabsTrigger value="form" className="text-xs">Formulário</TabsTrigger>
            <TabsTrigger value="comments" className="text-xs">Comentar</TabsTrigger>
            <TabsTrigger value="attachments" className="text-xs">Anexos</TabsTrigger>
            <TabsTrigger value="history" className="text-xs">Histórico</TabsTrigger>
            <TabsTrigger value="agenda" className="text-xs">Agenda</TabsTrigger>
            <TabsTrigger value="tracking" className="text-xs">Rastreio</TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="space-y-3">
            <div className="space-y-2 text-sm">
              <Row k="Origem" v={lead.source} />
              <Row k="Corretor" v={lead.broker_name} />
              <Row k="Atribuído em" v={lead.assigned_at ? dateTime(lead.assigned_at) : null} />
              <Row k="Primeiro contato" v={lead.first_contact_at ? dateTime(lead.first_contact_at) : null} />
              <Row k="Próxima ação" v={lead.next_action_at ? dateTime(lead.next_action_at) : null} />
              <Row k="Qualificado pela IA" v={lead.sdr_qualified_at ? dateTime(lead.sdr_qualified_at) : null} />
              <Row k="Notas" v={lead.notes} />
            </div>
            {/* `key` por versão do lead: o registro muda por baixo (roleta,
                realtime) e o formulário precisa refletir o que está no banco,
                sem um efeito copiando prop para estado. */}
            <EditFields key={`${lead.id}-${lead.updated_at}`} lead={lead} onSaved={() => onStageChanged?.()} />
          </TabsContent>

          <TabsContent value="form">
            {Object.keys(answers).length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem respostas de formulário.</p>
            ) : (
              <div className="space-y-2">
                {lead.form_name && <p className="text-xs text-muted-foreground">Formulário: <span className="font-medium">{lead.form_name}</span></p>}
                {Object.entries(answers).map(([key, value]) => <Row key={key} k={key} v={String(value)} />)}
              </div>
            )}
          </TabsContent>

          <TabsContent value="comments" className="space-y-3">
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {comments.map((comment) => (
                <div key={comment.id} className="rounded-xl border border-border bg-muted/40 p-2">
                  <p className="text-xs text-muted-foreground">
                    {comment.author_name} · {dateTime(comment.created_at)}
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm">{comment.body}</p>
                </div>
              ))}
              {comments.length === 0 && <p className="text-sm text-muted-foreground">Nenhum comentário ainda.</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={commentId}>Novo comentário</Label>
              <div className="flex gap-2">
                <Textarea
                  id={commentId} rows={2} value={newComment}
                  onChange={(event) => setNewComment(event.target.value)}
                  placeholder={`Comentar como ${actorName}…`}
                />
                <Button
                  size="icon" className="self-end" aria-label="Enviar comentário"
                  onClick={submitComment} disabled={!newComment.trim() || sendingComment}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              O comentário entra no histórico do lead junto com o log automático.
            </p>
          </TabsContent>

          <TabsContent value="attachments" className="space-y-3">
            <input ref={fileRef} type="file" className="hidden" onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
              event.target.value = "";
            }} />
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
              <Upload className="h-4 w-4" /> {uploading ? "Enviando…" : "Anexar arquivo"}
            </Button>
            <div className="space-y-2">
              {attachments.map((attachment) => (
                <div key={attachment.id} className="flex items-center justify-between gap-2 rounded-xl border border-border bg-muted/40 p-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Paperclip className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="truncate text-sm">{attachment.original_name}</span>
                  </div>
                  <Button
                    size="icon" variant="ghost" className="h-8 w-8 shrink-0"
                    aria-label={`Baixar ${attachment.original_name}`} onClick={() => download(attachment)}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              {attachments.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Sem anexos. O negócio pode ser criado assim; os documentos
                  obrigatórios são cobrados no envio ao gerente.
                </p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="history">
            <div className="max-h-96 space-y-2 overflow-y-auto">
              {timeline.map((entry) => (
                <div
                  key={entry.id}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border p-2",
                    entry.manual ? "border-primary/30 bg-primary/5" : "border-border",
                  )}
                >
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", entry.manual ? "bg-primary" : "bg-muted-foreground/50")} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">
                      {dateTime(entry.at)}
                      {entry.author ? ` · ${entry.author}` : ""}
                      {entry.manual ? " · comentário" : ""}
                    </p>
                    <p className="whitespace-pre-wrap text-sm">{entry.text}</p>
                  </div>
                </div>
              ))}
              {timeline.length === 0 && <p className="text-sm text-muted-foreground">Sem histórico.</p>}
            </div>
          </TabsContent>

          <TabsContent value="agenda" className="space-y-4">
            <TaskPanel refType="lead" refId={lead.id} defaultAssignee={lead.assigned_to ?? null} />
            <div className="border-t border-border pt-3">
              <VisitPanel leadId={lead.id} brokerId={lead.assigned_to ?? null} />
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

/**
 * Edição direta dos dados do lead. Cada campo tem `<label htmlFor>` ligado a um
 * `id` de `useId` — o `<Label>` solto de antes não apontava para nada e o leitor
 * de tela anunciava quatro campos sem nome (X04).
 */
function EditFields({ lead, onSaved }: { lead: LeadRecord; onSaved?: () => void }) {
  const fieldId = useId();
  const [values, setValues] = useState<Record<EditableField, string>>(() => ({
    full_name: lead.full_name ?? "",
    phone: lead.phone ?? "",
    email: lead.email ?? "",
    document: lead.document ?? "",
  }));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const patch: LeadPatch = {
        full_name: values.full_name.trim() || undefined,
        phone: values.phone.trim() || null,
        email: values.email.trim() || null,
        document: values.document.trim() || null,
      };
      await updateLead(lead.id, patch);
      toast({ title: "Dados salvos" });
      onSaved?.();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erro ao salvar",
        description: describeError(err, "sem permissão para este lead"),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {EDIT_FIELDS.map((field) => (
          <div key={field.key} className="space-y-1.5">
            <Label htmlFor={`${fieldId}-${field.key}`}>{field.label}</Label>
            <Input
              id={`${fieldId}-${field.key}`}
              type={field.type || "text"}
              value={values[field.key]}
              onChange={(event) => setValues((prev) => ({ ...prev, [field.key]: event.target.value }))}
            />
          </div>
        ))}
      </div>
      <Button size="sm" onClick={save} disabled={saving}>
        <Save className="h-4 w-4" /> {saving ? "Salvando…" : "Salvar"}
      </Button>
    </div>
  );
}

function Row({ k, v }: { k: string; v?: string | null }) {
  if (!v) return null;
  return (
    <div className="flex flex-col gap-0.5 text-sm sm:flex-row sm:gap-2">
      <span className="capitalize text-muted-foreground sm:min-w-[150px]">{k.replace(/_/g, " ")}:</span>
      <span className="min-w-0 flex-1 break-words">{v}</span>
    </div>
  );
}
