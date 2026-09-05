import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Upload, Download, Paperclip, Loader2, History, CheckCircle2, RotateCcw, Send, Trash2, FileX,
  AlertTriangle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { describeError } from "@/lib/supabaseError";
import { EmptyState, LoadingState } from "@/components/shared";
import { DOCUMENT_REVIEW_META } from "@/components/pipeline/review";
import {
  canAttachNow,
  canEditDeal,
  countDealManagers,
  dealParticipantNames,
  deleteDealDocument,
  getDealDocumentReview,
  listDealDocuments,
  listDocumentTypes,
  listMyDealRoles,
  missingRequiredTypes,
  missingStoragePaths,
  reviewDealDocuments,
  signedDocumentUrl,
  submitBlockReason,
  submitDealForManagerReview,
  uploadDealDocument,
  validateDocumentFile,
  type DealDocumentReview,
  type DealDocumentRecord,
  type DocumentTypeRecord,
} from "@/integrations/supabase/documents";

type Props = {
  dealId: string;
  clientName: string;
  dealCode: string;
  /** Construtora já gravada no negócio. Sem ela o banco recusa o envio ao
   *  gerente (0047) e a entrada no CCA — o botão avisa em vez de falhar. */
  hasDeveloper: boolean;
  /** Mês-base congelado (`YYYY-MM`), ou `null` com o período aberto.
   *
   *  A aprovação do gerente move o negócio para "Em análise" na mesma transação,
   *  e `deals_guard_closed_month` recusa qualquer gravação em mês fechado: sem
   *  isto o gerente clicava "Aprovar e enviar ao CCA" e recebia a recusa crua do
   *  gatilho em toast, depois de a tela ter prometido a ação. Quem sabe do mês é
   *  o modal (`useDealWriteLock`), então a resposta desce por prop em vez de
   *  esta aba abrir a própria consulta. */
  closedMonth?: string | null;
  /** Mês-base cujo fechamento não pôde ser confirmado (consulta de
   *  `closed_months` pendente ou com erro). Bloqueia igual, com frase honesta:
   *  o modal já mostra a mesma explicação acima das abas. */
  unconfirmedMonth?: string | null;
  onReviewChanged?: () => void | Promise<void>;
};

const formatSize = (bytes: number | null) => {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * "Conferido por Fulano em 02/09/2026 14:30" — a auditoria que o banco já
 * guardava e a tela não mostrava.
 *
 * O nome pode faltar (um admin que decidiu sem estar no rateio não aparece em
 * `deal_participant_names`), e nesse caso sai só a data: dizer "por —" seria
 * pior que não dizer. A data nunca falta quando o estado saiu de 'draft'.
 */
const assinatura = (
  quem: string | null,
  quando: string | null,
  nomes: Record<string, string>,
): string | null => {
  if (!quando) return null;
  const nome = quem ? nomes[quem] : undefined;
  const data = new Date(quando).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  return nome ? `${nome} · ${data}` : data;
};

/**
 * Um slot por tipo de documento, com renomeação automática no envio.
 *
 * Antes desta tela os arquivos escolhidos ficavam em `useState` e nunca subiam:
 * o bucket `deal-documents` existia sem nunca ter recebido nada. Versão
 * substituída continua listada — é o histórico que o CCA pediu, e quem marca a
 * anterior é o trigger `deal_documents_supersede`.
 */
export default function DealDocumentUpload({
  dealId, clientName, dealCode, hasDeveloper, closedMonth, unconfirmedMonth, onReviewChanged,
}: Props) {
  const { toast } = useToast();
  const { user, isAdmin, can } = useAuth();
  const fieldId = useId();
  const [types, setTypes] = useState<DocumentTypeRecord[]>([]);
  const [docs, setDocs] = useState<DealDocumentRecord[]>([]);
  const [review, setReview] = useState<DealDocumentReview | null>(null);
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [myRoles, setMyRoles] = useState<string[]>([]);
  const [canUpload, setCanUpload] = useState(false);
  const [managerCount, setManagerCount] = useState(0);
  const [loading, setLoading] = useState(true);
  /** Falha da CARGA, separada do vazio. Sem ela `types` ficava `[]` e a tela
   *  culpava o catálogo ("Catálogo desligado", "peça ao CCA para religar") por
   *  qualquer queda de rede ou recusa de RLS — mandando o corretor cobrar de
   *  quem não tem o problema. */
  const [erro, setErro] = useState<unknown>(null);
  /** Caminhos sem arquivo no bucket, ou `null` quando a conferência não voltou.
   *  Os dois estados são diferentes: `null` não pode virar "arquivo ausente" em
   *  documento nenhum — uma queda de rede acusaria o dossiê inteiro de vazio. */
  const [semArquivo, setSemArquivo] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewReason, setReviewReason] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const [t, d, r, roles, managers, podeEditar, participantes] = await Promise.all([
        listDocumentTypes(),
        listDealDocuments(dealId),
        getDealDocumentReview(dealId),
        user?.id ? listMyDealRoles(dealId, user.id) : Promise.resolve([]),
        countDealManagers(dealId),
        canEditDeal(dealId),
        dealParticipantNames(dealId),
      ]);
      setTypes(t);
      setDocs(d);
      setReview(r);
      setNomes(participantes);
      setMyRoles(roles);
      setManagerCount(managers);
      setCanUpload(podeEditar);

      // Depois do `Promise.all` porque depende da lista, e num `try` próprio:
      // dossiê que carregou não pode sumir da tela porque a conferência do
      // armazenamento caiu — sem ela a lista volta ao que sempre foi, com o
      // "Baixar" acusando a falha no clique.
      setSemArquivo(null);
      try {
        setSemArquivo(await missingStoragePaths(d.map((doc) => doc.storage_path)));
      } catch (falha) {
        console.warn("[documentos] não deu para conferir os arquivos no bucket:", falha);
      }
    } catch (e) {
      setErro(e);
    } finally {
      setLoading(false);
    }
  }, [dealId, user?.id]);

  useEffect(() => { void load(); }, [load]);

  const byType = useMemo(() => {
    const map = new Map<string, DealDocumentRecord[]>();
    for (const d of docs) {
      const list = map.get(d.document_type_id) ?? [];
      list.push(d);
      map.set(d.document_type_id, list);
    }
    return map;
  }, [docs]);

  const clearInput = (typeId: string) => {
    // Permite reenviar o mesmo arquivo: sem isto o input não dispara change.
    const el = inputRefs.current[typeId];
    if (el) el.value = "";
  };

  const handleFiles = async (type: DocumentTypeRecord, files: FileList | null) => {
    if (!files || files.length === 0) return;
    const chosen = type.allows_multiple ? Array.from(files) : [files[0]];

    // Fronteira antes do envio: um arquivo de 300 MB ou um `.exe` só era
    // recusado (quando era) depois de subir. Nenhum sobe se algum não serve —
    // aceitar metade da escolha em silêncio seria pior que recusar tudo.
    const rejected = chosen.map((file) => validateDocumentFile(file)).filter(Boolean);
    if (rejected.length > 0) {
      clearInput(type.id);
      return toast({
        title: rejected.length > 1 ? `${rejected.length} arquivos recusados` : "Arquivo recusado",
        description: rejected.join(" "),
        variant: "destructive",
      });
    }

    setBusy(type.id);
    let enviados = 0;
    try {
      for (const file of chosen) {
        await uploadDealDocument({ dealId, documentType: type, file, clientName, dealCode });
        enviados += 1;
      }
      toast({
        title: chosen.length > 1 ? `${chosen.length} arquivos enviados` : "Documento enviado",
        description: type.allows_multiple ? undefined : "A versão anterior foi mantida no histórico.",
      });
    } catch (e) {
      toast({
        title: "Falha no envio",
        // Falha no MEIO de um lote não é "nada subiu": dizer quantos entraram
        // evita o reenvio do lote inteiro, que duplicaria o que já está lá.
        description: enviados > 0
          ? `${enviados} de ${chosen.length} arquivo(s) foram anexados antes da falha. ${describeError(e, "Não foi possível anexar o restante.")}`
          : describeError(e, "Não foi possível anexar o documento."),
        variant: "destructive",
      });
    } finally {
      // Recarrega SEMPRE: no caminho de erro os arquivos que subiram antes da
      // falha ficavam invisíveis até alguém reabrir a aba Anexos — e o obrigatório
      // que já estava lá continuava contado como faltante.
      if (enviados > 0) await load();
      setBusy(null);
      clearInput(type.id);
    }
  };

  /**
   * A aba abre ANTES de assinar a URL, de propósito.
   *
   * `window.open` depois de um `await` perde o gesto do usuário: em iOS/Safari o
   * pop-up é bloqueado sem lançar erro, o `catch` não dispara e o botão "Baixar"
   * simplesmente não faz nada. Abrindo em branco no clique e trocando o endereço
   * quando a assinatura chega, o gesto continua valendo.
   */
  const download = async (doc: DealDocumentRecord) => {
    const janela = window.open("", "_blank");
    if (janela) janela.opener = null;
    try {
      const url = await signedDocumentUrl(doc);
      if (janela) janela.location.href = url;
      else window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      janela?.close();
      toast({
        title: "Não foi possível baixar",
        description: describeError(
          e,
          "O arquivo não está no armazenamento, ou está fora do seu acesso a este negócio. Anexe o documento de novo.",
        ),
        variant: "destructive",
      });
    }
  };

  const remove = async (doc: DealDocumentRecord) => {
    setBusy(doc.id);
    try {
      await deleteDealDocument(doc);
      await load();
      toast({ title: "Documento excluído", description: doc.stored_name });
    } catch (e) {
      toast({
        title: "Não foi possível excluir",
        description: describeError(e, "O documento continua no dossiê."),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const submitForReview = async () => {
    setReviewBusy(true);
    try {
      await submitDealForManagerReview(dealId);
      await load();
      await onReviewChanged?.();
      toast({
        title: "Documentos enviados para conferência",
        description: "Os gerentes vinculados foram notificados.",
      });
    } catch (e) {
      toast({
        title: "Não foi possível enviar",
        description: describeError(e, "Não foi possível enviar os documentos ao gerente."),
        variant: "destructive",
      });
    } finally {
      setReviewBusy(false);
    }
  };

  const decideReview = async (approve: boolean) => {
    setReviewBusy(true);
    try {
      await reviewDealDocuments({ dealId, approve, reason: reviewReason });
      setReviewReason("");
      await load();
      await onReviewChanged?.();
      toast({
        title: approve ? "Documentos aprovados" : "Documentos devolvidos ao corretor",
        description: approve ? "O negócio seguiu para a esteira de análise." : "O corretor recebeu o motivo da devolução.",
      });
    } catch (e) {
      toast({
        title: approve ? "Não foi possível aprovar" : "Não foi possível devolver",
        description: describeError(
          e,
          approve
            ? "Não foi possível aprovar os documentos."
            : "Não foi possível devolver os documentos ao corretor.",
        ),
        variant: "destructive",
      });
    } finally {
      setReviewBusy(false);
    }
  };

  if (loading) {
    return <LoadingState variant="list" rows={3} label="Carregando documentos…" />;
  }

  // Antes do ramo de catálogo vazio, de propósito: com `types = []` os dois
  // caminhos davam a MESMA tela, e só um deles é culpa do catálogo.
  if (erro) {
    return (
      <EmptyState
        icon={AlertTriangle}
        tone="danger"
        title="Não consegui carregar os documentos"
        description={describeError(erro, "Verifique a conexão e tente de novo.")}
        action={
          <Button size="sm" variant="outline" onClick={() => void load()}>
            Tentar de novo
          </Button>
        }
      />
    );
  }

  // Regra única: a mesma função que o vitest cobre, em vez da cópia que a tela
  // mantinha (`missingRequiredTypes` era importada só pelo teste).
  // Documento sem arquivo não cumpre obrigatório: contá-lo dava
  // "Obrigatórios completos" e liberava o envio ao gerente de um dossiê que o
  // analista não conseguiria abrir. Com a conferência ainda pendente (`null`) a
  // lista inteira vale, como sempre valeu — desconfiar do que não foi
  // verificado travaria o envio a cada oscilação de rede.
  const missing = missingRequiredTypes(
    types,
    semArquivo ? docs.filter((d) => !semArquivo.has(d.storage_path)) : docs,
  );
  const status = review?.document_review_status ?? "draft";
  const canSubmit = isAdmin || myRoles.includes("broker");
  const canReview = isAdmin || myRoles.includes("manager");
  // Excluir só enquanto o dossiê é do corretor: a policy `deal_documents_delete`
  // (0059) recusa depois do envio, e botão que o banco recusa não aparece.
  const canDelete = (isAdmin || myRoles.includes("broker")) && (status === "draft" || status === "returned");
  // Anexar segue a MESMA cláusula que `deal_documents_insert` cobra desde a
  // 0077: depois do envio ao gerente o dossiê é prova. Sem isto o corretor
  // trocava a versão que o gerente aprovou e que o analista ia baixar, e o
  // banco aceitava calado. O CCA continua podendo juntar documento depois.
  const canAttach = canUpload && canAttachNow({ status, isAdmin, hasCcaReview: can("cca.review") });
  const meta = DOCUMENT_REVIEW_META[status];
  const enviadoPor = assinatura(review?.document_review_requested_by ?? null, review?.document_review_requested_at ?? null, nomes);
  const decididoPor = assinatura(review?.document_reviewed_by ?? null, review?.document_reviewed_at ?? null, nomes);
  // A aprovação do gerente entra no CCA na mesma transação e o CCA exige
  // construtora: quem conserta é o corretor, na aba Detalhes, antes de enviar.
  // A falta de gerente vinculado é a outra recusa do banco (0028:404) — as duas
  // são checadas aqui para o corretor não receber a mensagem crua em toast.
  // Catálogo inteiro desligado em Esteira CCA → Tipos de documento: sem tipo
  // ativo, `missing` volta vazio e a tela diria "Obrigatórios completos" sobre
  // um dossiê sem um único anexo. As duas telas ficaram acopladas na 0059.
  // Só chega aqui com a carga OK (o ramo de `erro` já retornou): lista vazia
  // por falha e lista vazia por catálogo desligado não podem dar a mesma tela.
  const semCatalogo = types.length === 0;
  // Motivo e trava saem da MESMA função (coberta em `documents.test.ts`): o
  // botão só habilita quando não há o que dizer.
  const submitHint = submitBlockReason({
    types, documents: docs, hasDeveloper, managerCount, closedMonth, unconfirmedMonth,
  });
  const canSend = submitHint === null;
  // São TRÊS gravações em `deals` nesta aba — enviar, devolver e aprovar — e o
  // mês congelado derruba as três: `review_deal_documents(approve=false)` grava
  // `document_review_status='returned'` (0028) e passa pelo mesmo
  // `deals_guard_closed_month`. "Devolver" ficava de fora e o gerente levava a
  // recusa crua do gatilho em toast, com o motivo escrito na tela logo acima.
  // Não dá para reaproveitar `canSend` aqui: devolver com obrigatório faltando é
  // exatamente o caso de uso do botão, e o banco aceita.
  const monthBlocked = Boolean(closedMonth || unconfirmedMonth);

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border/60 bg-muted/10 p-3 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <p className="text-sm font-bold">Conferência documental</p>
            <p className="text-xs text-muted-foreground">Corretor → gerente → CCA</p>
          </div>
          <Badge variant="outline" className={meta.className}>{meta.label}</Badge>
        </div>

        {/* A auditoria estava no banco e invisível na tela: `document_reviewed_by`
            e `document_reviewed_at` eram lidos e nunca renderizados. Quem devolveu
            o dossiê é a primeira pergunta do corretor que recebe a devolução. */}
        {(enviadoPor || decididoPor) && (
          <dl className="space-y-0.5 text-xs text-muted-foreground">
            {enviadoPor && (
              <div className="flex flex-wrap gap-x-1">
                <dt>Enviado por</dt>
                <dd className="text-foreground">{enviadoPor}</dd>
              </div>
            )}
            {decididoPor && (
              <div className="flex flex-wrap gap-x-1">
                <dt>{status === "returned" ? "Devolvido por" : "Conferido por"}</dt>
                <dd className="text-foreground">{decididoPor}</dd>
              </div>
            )}
          </dl>
        )}

        {status === "returned" && review?.document_review_reason && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2">
            <p className="text-xs font-semibold text-destructive">Motivo da devolução</p>
            <p className="text-xs text-foreground mt-0.5">{review.document_review_reason}</p>
          </div>
        )}

        {canSubmit && (status === "draft" || status === "returned") && (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-muted-foreground">
              {submitHint
                ?? (missing.length > 0
                  ? `Anexe os ${missing.length} tipo(s) obrigatório(s) antes de enviar.`
                  : "Dossiê pronto para o gerente conferir.")}
            </p>
            <Button
              size="sm"
              className="h-8 text-xs gap-1 shrink-0"
              disabled={reviewBusy || !canSend}
              onClick={submitForReview}
            >
              {reviewBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              Enviar ao gerente
            </Button>
          </div>
        )}

        {/* Quem não é corretor nem gerente do negócio (um diretor fora do rateio,
            por exemplo) via a caixa com o selo e mais nada. */}
        {!canSubmit && !canReview && (status === "draft" || status === "returned") && (
          <p className="text-xs text-muted-foreground">
            Só um corretor do rateio envia o dossiê à conferência; aqui você acompanha o andamento.
          </p>
        )}

        {canReview && status === "pending" && (
          <div className="space-y-2">
            {submitHint && <p className="text-xs text-warning">{submitHint}</p>}
            <Textarea
              aria-label="Motivo da devolução"
              value={reviewReason}
              onChange={(event) => setReviewReason(event.target.value)}
              placeholder="Motivo obrigatório somente para devolver ao corretor"
              rows={2}
              maxLength={2000}
              className="text-xs"
            />
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1 text-destructive border-destructive/40"
                disabled={reviewBusy || !reviewReason.trim() || monthBlocked}
                onClick={() => decideReview(false)}
              >
                <RotateCcw className="h-3 w-3" /> Devolver
              </Button>
              <Button
                size="sm"
                className="h-8 text-xs gap-1 bg-success hover:bg-success/90 text-success-foreground"
                // O mês fechado entra aqui pelo mesmo motivo da construtora: a
                // aprovação move o negócio para "Em análise" na mesma transação,
                // e o gatilho recusa a gravação inteira. O motivo já aparece
                // acima, em `submitHint` — a mesma frase que trava o envio do
                // corretor e, agora, o "Devolver" ao lado.
                disabled={reviewBusy || !hasDeveloper || monthBlocked}
                onClick={() => decideReview(true)}
              >
                {reviewBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                Aprovar e enviar ao CCA
              </Button>
            </div>
          </div>
        )}

        {status === "pending" && !canReview && (
          <p className="text-xs text-muted-foreground">Aguardando a decisão de um gerente vinculado ao negócio.</p>
        )}
        {status === "approved" && (
          // "Esteira Ágil" é como a operação chama esta fronteira (CONTEXT.md), e
          // o nome não aparecia em tela nenhuma: existia só como texto do
          // Status 2, que o corretor não relaciona com o que acabou de acontecer.
          <p className="text-xs text-success">
            Conferência concluída: o negócio entrou na <strong>Esteira Ágil</strong>, a análise de
            crédito. O andamento aparece no Status 2 e no histórico do negócio.
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-sm font-bold text-success">Anexar Documentos</p>
        {semCatalogo ? (
          <Badge variant="destructive">Catálogo desligado</Badge>
        ) : missing.length > 0 ? (
          <Badge variant="destructive">
            Faltam {missing.length} obrigatório{missing.length > 1 ? "s" : ""}
          </Badge>
        ) : (
          <Badge variant="outline">Obrigatórios completos</Badge>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-xs gap-1 ml-auto"
          onClick={() => setShowHistory((v) => !v)}
        >
          <History className="h-3 w-3" /> {showHistory ? "Ocultar" : "Ver"} histórico
        </Button>
      </div>

      {/* Botão que some precisa dizer por quê: sem esta frase o corretor abre a
          aba depois de enviar ao gerente e procura o "Anexar" que sumiu. */}
      {canUpload && !canAttach && (
        <p className="rounded-md border border-border/50 bg-muted/20 p-2 text-xs text-muted-foreground">
          {status === "pending"
            ? "O dossiê está com o gerente: trocar um arquivo agora mudaria o que ele está conferindo. Peça a devolução para anexar de novo."
            : "A conferência foi aprovada e o dossiê seguiu para a análise de crédito. Só o CCA junta documento a partir daqui."}
        </p>
      )}

      {semCatalogo && (
        <EmptyState
          icon={FileX}
          tone="danger"
          title="Nenhum tipo de documento ativo"
          description="O catálogo foi desligado em Esteira CCA → Tipos de documento. Sem tipo ativo não há o que anexar nem o que o gerente conferir."
        />
      )}

      <div className="space-y-2">
        {types.map((type) => {
          const all = byType.get(type.id) ?? [];
          const current = all.filter((d) => !d.superseded_at);
          const superseded = all.filter((d) => d.superseded_at);
          const visible = showHistory ? all : current;
          const rotulo = (
            <>
              {type.required_for_conversion && <span className="text-destructive mr-1">*</span>}
              {type.label}
              {type.allows_multiple && (
                <span className="ml-1 text-xs font-normal text-muted-foreground">(vários)</span>
              )}
            </>
          );

          return (
            <div key={type.id} className="rounded-lg border border-border/60 bg-muted/10 p-2.5">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                {/* `htmlFor`/`id` e `aria-label`: os nove campos compartilhavam o
                    mesmo nome acessível ("Anexar"), e o input escondido não
                    tinha nome nenhum — quem usa leitor de tela ouvia nove
                    botões idênticos. */}
                {canAttach ? (
                  <label htmlFor={`${fieldId}-${type.id}`} className="text-xs font-semibold text-foreground flex-1">
                    {rotulo}
                  </label>
                ) : (
                  // `label` sem controle associado é ruído para leitor de tela:
                  // quando não há campo de arquivo, o rótulo é texto.
                  <p className="text-xs font-semibold text-foreground flex-1">{rotulo}</p>
                )}
                {/* Sem `can_edit_deal` o insert em `deal_documents` é barrado
                    depois de o arquivo já ter subido: o botão sai da tela em
                    vez de o banco recusar (a explicação fica na lista abaixo). */}
                {canAttach && (
                  <>
                    <input
                      id={`${fieldId}-${type.id}`}
                      aria-label={type.label}
                      ref={(el) => (inputRefs.current[type.id] = el)}
                      type="file"
                      multiple={type.allows_multiple}
                      className="hidden"
                      onChange={(e) => handleFiles(type, e.target.files)}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1"
                      aria-label={`Anexar ${type.label}`}
                      disabled={busy === type.id}
                      onClick={() => inputRefs.current[type.id]?.click()}
                    >
                      {busy === type.id
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <Upload className="h-3 w-3" />}
                      Anexar
                    </Button>
                  </>
                )}
              </div>

              {visible.length > 0 ? (
                <div className="space-y-1">
                  {visible.map((d) => {
                  // O registro existe e o arquivo não: oferecer "Baixar" aqui é
                  // prometer o que a assinatura vai recusar. A linha diz o que
                  // aconteceu e passa a oferecer o reenvio, que é o único
                  // conserto — o arquivo não volta sozinho.
                  const ausente = semArquivo?.has(d.storage_path) === true;
                  return (
                    <div
                      key={d.id}
                      // `flex-wrap` + `min-w-0`: a 375 px o nome do arquivo, a
                      // versão, o tamanho e os dois botões não cabem numa linha
                      // — sem quebrar, "Baixar" e "Excluir" saíam da tela.
                      className={`flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded px-2 py-1 text-xs ${
                        ausente ? "bg-destructive/10" : d.superseded_at ? "bg-muted/40 opacity-70" : "bg-success/10"
                      }`}
                    >
                      <span className={`flex min-w-0 flex-1 items-center gap-1 ${
                        ausente ? "text-destructive" : d.superseded_at ? "text-muted-foreground" : "text-success"
                      }`}>
                        {ausente
                          ? <FileX className="h-3 w-3 shrink-0" />
                          : <Paperclip className="h-3 w-3 shrink-0" />}
                        <span className="truncate">{d.stored_name}</span>
                        <span className="shrink-0 opacity-70">v{d.version} {formatSize(d.size_bytes)}</span>
                        {d.superseded_at && <span className="shrink-0 italic">· substituído</span>}
                        {ausente && <span className="shrink-0 font-semibold">· arquivo ausente</span>}
                      </span>
                      <span className="flex items-center gap-2 shrink-0">
                        {ausente ? (
                          canAttach && !d.superseded_at && (
                            <button
                              type="button"
                              onClick={() => inputRefs.current[type.id]?.click()}
                              aria-label={`Reenviar ${d.stored_name}`}
                              className="text-primary hover:text-primary/80 flex items-center gap-1"
                            >
                              <Upload className="h-3 w-3" /> Reenviar
                            </button>
                          )
                        ) : (
                          <button
                            type="button"
                            onClick={() => download(d)}
                            aria-label={`Baixar ${d.stored_name}`}
                            className="text-primary hover:text-primary/80 flex items-center gap-1"
                          >
                            <Download className="h-3 w-3" /> Baixar
                          </button>
                        )}
                        {canDelete && !d.superseded_at && (
                          <button
                            type="button"
                            onClick={() => remove(d)}
                            disabled={busy === d.id}
                            aria-label={`Excluir ${d.stored_name}`}
                            className="text-destructive hover:text-destructive/80 flex items-center gap-1 disabled:opacity-50"
                          >
                            {busy === d.id
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : <Trash2 className="h-3 w-3" />}
                            Excluir
                          </button>
                        )}
                      </span>
                    </div>
                  );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  {canAttach
                    ? "Nenhum arquivo anexado"
                    : canUpload
                      ? "Nenhum arquivo anexado. O dossiê saiu para a conferência e não recebe mais arquivo."
                      : "Nenhum arquivo anexado. Você acompanha este dossiê; anexar é de quem edita o negócio."}
                </p>
              )}

              {!showHistory && superseded.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  +{superseded.length} versão(ões) no histórico
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
