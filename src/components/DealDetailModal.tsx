import { useEffect, useId, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { describeError } from "@/lib/supabaseError";
import { useAuth } from "@/contexts/AuthContext";
import type { DealStage } from "@/types/crm";
import { toast } from "@/hooks/use-toast";
import {
  dealStageCodeFor, primaryRole, type PersonRecord, type SaveLegacyDealInput,
} from "@/integrations/supabase/newSchema";
import {
  DealCcaPanel, DealCommentsPanel, DealForm, dealRequiredError, saveCcaAnalysis, useDealWriteLock,
  type CcaAnalysis, type PipelineStage,
} from "@/components/pipeline";
import { addDealComment, countDealComments } from "@/components/pipeline/DealCommentsPanel";
import { ConferenciaGerenteDialog } from "@/components/pipeline/ConferenciaGerenteDialog";
import { submitDealForManagerReview } from "@/integrations/supabase/documents";
import { BatidaCpfDialog } from "@/components/pipeline/BatidaCpfDialog";
import {
  assumirNegocioDoCpf, cpfsParaBatida, negocioDoCpf, type NegocioDoCpf,
} from "@/integrations/supabase/batidaCpf";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { vendaTemCard } from "@/components/pipeline/useDealActions";
import DealDocumentUpload from "@/components/DealDocumentUpload";
import DealHistoryPanel from "@/components/DealHistoryPanel";
import TaskPanel from "@/components/TaskPanel";
import VisitPanel from "@/components/VisitPanel";

interface Props {
  /** `null`/ausente = criar. É o único editor de negócio da aplicação (A02). */
  deal?: SaveLegacyDealInput | null;
  open: boolean;
  onClose: () => void;
  /** Devolve o id gravado; o negócio novo precisa dele para o comentário inicial. */
  onSave: (deal: SaveLegacyDealInput) => Promise<string | void>;
  onReviewChanged?: () => void | Promise<void>;
  people: PersonRecord[];
  developers: { id: string; name: string }[];
  /** Catálogo de etapas — traz o `id` que `can_enter_stage()` autoriza. */
  stages: PipelineStage[];
  /** Mês-base sugerido para um negócio novo (o do ciclo aberto do game). */
  defaultMonth?: string;
  /** Fecha o modal só depois de TODAS as gravações (negócio e análise do CCA).
   *  Fechar dentro de `onSave` apagava a análise digitada quando só ela falhava. */
  closeOnSave?: boolean;
  /** Negócio encerrado assumido na batida de CPF: quem abriu a ficha o mostra. */
  onAssumido?: (dealId: string) => void | Promise<void>;
}

type TabKey = "detalhes" | "comentarios" | "anexos" | "agenda" | "historico" | "cca";

/**
 * Negócio em branco.
 *
 * `broker1_id` nasce com o próprio usuário quando ele é corretor: o direito de
 * editar o negócio vem de estar em `deal_participants` (`can_edit_deal`), então
 * criar um negócio sem nenhum participante trancaria o criador para fora do que
 * ele acabou de criar — sem conseguir nem reabrir para corrigir.
 *
 * "Ser corretor" aqui é `primaryRole(roles) === 'broker'`, a mesma precedência
 * que a migration 0048 aplica no gatilho `deals_add_creator_participant`, e não
 * `roles.includes('broker')`: `handle_new_auth_user` (0002) dá `broker` a TODO
 * perfil novo e nunca o retira, então admin, gerente e diretor caíam neste
 * pré-preenchimento, viravam "Corretor 1" com 100% do rateio de VGV e os pontos
 * de venda do game — exatamente o que a 0048 tirou do banco e que este
 * formulário estava recolocando por cima. Para eles o campo nasce vazio e a
 * escolha é ato explícito; ninguém fica trancado fora do negócio: admin e CCA
 * passam por `has_permission('cca.review')` e gerente/diretor ganham a própria
 * linha pelo gatilho da 0048.
 */
const emptyDeal = (stageCode: string, month?: string, selfBrokerId?: string): SaveLegacyDealInput => ({
  client: "", developer: "", project: "", unit: "",
  status: "PROPOSTA",
  // Fronteira: o código vem do catálogo do banco e `DealStage` é o espelho dele.
  stage: stageCode as DealStage,
  broker1: "", manager1: "", deal_value: 0,
  broker1_id: selfBrokerId ?? null,
  active: true, created_at: new Date().toISOString(), month_base: month, notes: "",
});

/**
 * Editor do negócio — criar e editar pelo mesmo lugar.
 *
 * Havia dois caminhos gravando o mesmo registro (achado A02): este modal e um
 * diálogo inline no Pipeline, que salvava um subconjunto dos campos (sem
 * gerentes, sem dados do cliente além do nome, sem Status 2). Ficou este, com
 * `deal` opcional para o caso de criação; o inline saiu.
 *
 * As abas que dependem do `id` do negócio (anexos, agenda, histórico, CCA) só
 * abrem depois de salvar — antes elas consultavam com um id inexistente.
 */
export default function DealDetailModal({
  deal, open, onClose, onSave, onReviewChanged, people, developers, stages, defaultMonth, closeOnSave, onAssumido,
}: Props) {
  const { user } = useAuth();
  const id = useId();
  const field = (name: string) => `${id}-${name}`;

  const [form, setForm] = useState<SaveLegacyDealInput>(() => {
    if (deal) return { ...deal };
    const self = people.find((person) => person.id === user?.id && primaryRole(person.roles) === "broker");
    return emptyDeal(stages[0]?.code ?? "incomplete", defaultMonth, self?.id);
  });
  const [tab, setTab] = useState<TabKey>("detalhes");
  const [cca, setCca] = useState<CcaAnalysis>({});
  const [saving, setSaving] = useState(false);
  /** Negócio novo: comentário que vai para a aba Comentários depois de criado. */
  const [comentarioInicial, setComentarioInicial] = useState("");
  /** Já houve uma tentativa de salvar. Só depois dela o campo obrigatório vazio
   *  vira erro: cobrar antes pintaria de vermelho um formulário recém-aberto. */
  const [tentouSalvar, setTentouSalvar] = useState(false);

  // A MESMA resposta que desabilita os campos (`DealForm` chama este hook com
  // este mesmo `form`). Enquanto só o formulário a lia, o mês fechado e o perfil
  // sem escrita deixavam ~40 campos cinzas com "Confirmar alterações"
  // habilitado: o clique ia ao banco só para voltar recusado por
  // `deals_guard_closed_month`/`can_edit_deal`. Gesto que a tela oferece e o
  // banco recusa é exatamente o que `useDealWriteLock` existe para eliminar.
  const lock = useDealWriteLock(form);

  // Derivado na renderização, não guardado em state: escolher a construtora
  // apaga a frase no mesmo instante, sem efeito nem segundo clique em salvar.
  const developerError = tentouSalvar ? dealRequiredError(form) : null;

  /** Negócio criado pelo popup de conferência: a ficha fica aberta, agora como
   *  edição, para anexar os documentos e enviar ao gerente. */
  const [criadoId, setCriadoId] = useState<string | null>(null);
  const dealId = deal?.id ?? criadoId;
  const isNew = !dealId;
  /** Popup "Conferência do gerente" (Status 2 Em análise / Esteira Ágil). */
  const [conferencia, setConferencia] = useState<{ enviando: boolean; erro: string | null } | null>(null);
  const [mensagemEnvio, setMensagemEnvio] = useState("");
  /** Batida de CPF que achou negócio (0179). */
  const [batida, setBatida] = useState<{ negocio: NegocioDoCpf; enviando: boolean; erro: string | null } | null>(null);

  // Contador no rótulo da aba: sem ele o comentário sai da aba "Detalhes" e vira
  // conteúdo escondido — ninguém clica numa aba que não avisa que tem algo. Em
  // falha de rede `countDealComments` devolve 0 de propósito: número decorativo
  // não pode derrubar a barra de abas.
  const [comentarios, setComentarios] = useState(0);
  useEffect(() => {
    if (!dealId) return;
    void countDealComments(dealId).then(setComentarios);
  }, [dealId]);

  const patch = (next: Partial<SaveLegacyDealInput>) =>
    setForm((previous) => ({ ...previous, ...next }));

  /** Grava o negócio. Devolve o id gravado, ou `null` quando nada foi gravado
   *  (a recusa já foi mostrada). `fechar: false` mantém a ficha aberta. */
  const handleSave = async (
    { fechar = Boolean(closeOnSave), avisar = true }: { fechar?: boolean; avisar?: boolean } = {},
  ): Promise<string | null> => {
    // Liga antes da primeira recusa, e não depois delas: o formulário nasce sem
    // corretor E sem construtora, então cobrar um campo por clique fazia o
    // operador descobrir a segunda pendência só na tentativa seguinte. Ligado
    // aqui, as duas aparecem juntas — e um formulário recém-aberto continua sem
    // nada pintado de vermelho, porque ninguém clicou em salvar ainda.
    setTentouSalvar(true);
    if (!form.client.trim()) {
      toast({ variant: "destructive", title: "O nome do cliente é obrigatório" });
      return null;
    }
    // Sem participante o negócio nasce fora do alcance de `can_edit_deal()`:
    // ninguém além de admin e CCA conseguiria abri-lo de novo.
    if (!form.broker1_id && !form.manager1_id) {
      toast({
        variant: "destructive",
        title: "Escolha ao menos um corretor ou gerente",
        description: "É o vínculo que dá acesso ao negócio depois de salvo.",
      });
      return null;
    }
    // "Construtora *" é recusa de CAMPO, e por isso não vai para toast: a frase
    // aparece uma vez, presa ao Select que a causou (`aria-invalid` +
    // `aria-describedby`), e o mesmo `dealRequiredError` continua guardando a
    // gravação em `Pipeline.onSave` para qualquer caminho que não passe aqui.
    // A frase fica na aba "Detalhes", e é onde o operador está: `dealRequiredError`
    // só cobra na CRIAÇÃO, e no negócio novo as outras quatro abas estão
    // desabilitadas até existir um `id`.
    if (dealRequiredError(form)) {
      // Sem levar o foco, o clique não muda nada VISÍVEL: o rodapé rola junto
      // com o conteúdo do diálogo, então quem clica em "Criar negócio" está no
      // fim, e a frase nasce ~13 campos acima, fora da área visível — a tela
      // pareceria travada. Focar o gatilho rola até ele, dá ao teclado o ponto
      // de partida certo e faz o leitor de tela reler o campo com a frase
      // ligada por `aria-describedby` a cada nova tentativa.
      document.getElementById(field("developer"))?.focus();
      return null;
    }
    // Batida de CPF (0179): um CPF, um negócio. Sem a resposta não cadastra — o
    // banco recusaria o CPF repetido de qualquer forma, com frase pior.
    if (isNew) {
      const cpfs = cpfsParaBatida(form);
      if (cpfs.length > 0) {
        try {
          const achado = await negocioDoCpf(cpfs);
          if (achado) {
            setBatida({ negocio: achado, enviando: false, erro: null });
            return null;
          }
        } catch (err) {
          toast({
            variant: "destructive",
            title: "Não foi possível conferir o CPF",
            description: describeError(err, "Tente de novo em instantes."),
          });
          return null;
        }
      }
    }
    setSaving(true);
    // São duas escritas: se só a análise do CCA falhar, o negócio JÁ foi gravado
    // e o aviso não pode dizer que nada foi salvo.
    let negocioGravado = false;
    // Negócio que passa a "Fechado" com corretor no rateio vira venda com card
    // próprio do `EngagementLayer`: o sucesso daqui sairia em cima dele.
    const virouVenda = dealStageCodeFor(form) === "closed" && (!deal || dealStageCodeFor(deal) !== "closed")
      && vendaTemCard(form);
    try {
      const novoId = await onSave(form);
      negocioGravado = true;
      const gravado = typeof novoId === "string" ? novoId : dealId;
      // Comentário escrito na criação: a aba Comentários só existe depois do id.
      const comentario = comentarioInicial.trim();
      if (isNew && comentario) {
        try {
          if (typeof novoId !== "string") throw new Error("o negócio voltou sem id");
          await addDealComment(novoId, comentario);
        } catch (err) {
          toast({
            variant: "destructive",
            title: "Negócio criado, mas o comentário não foi salvo",
            description: `${describeError(err, "O comentário não foi gravado.")} Abra o negócio e escreva de novo na aba Comentários.`,
          });
        }
      }
      if (dealId && Object.keys(cca).length > 0) await saveCcaAnalysis(dealId, cca);
      if (avisar && !virouVenda) toast({ variant: "success", title: isNew ? "Negócio criado" : "Negócio atualizado" });
      if (fechar) {
        onClose();
      } else if (isNew && gravado) {
        setCriadoId(gravado);
        patch({ id: gravado });
        setComentarioInicial("");
      }
      return gravado;
    } catch (err) {
      toast(negocioGravado
        ? {
          variant: "destructive",
          title: "Não foi possível salvar a análise do CCA",
          description: `O negócio foi atualizado. ${describeError(err, "A análise não foi gravada.")}`,
        }
        : {
          variant: "destructive",
          title: isNew ? "Não foi possível criar o negócio" : "Não foi possível salvar o negócio",
          description: describeError(err, isNew ? "O negócio não foi gravado." : "As alterações não foram gravadas."),
        });
      return null;
    } finally {
      setSaving(false);
    }
  };

  // Negócio já gravado e sem escrita (gerente de outro rateio, por exemplo):
  // o envio vai direto, sem regravar a ficha que o banco recusaria.
  const gravarAntesDoEnvio = () =>
    (dealId && lock.readOnly ? Promise.resolve(dealId) : handleSave({ fechar: false, avisar: false }));

  const enviarConferencia = async (mensagem: string) => {
    setConferencia({ enviando: true, erro: null });
    const gravado = await gravarAntesDoEnvio();
    if (!gravado) {
      setConferencia({ enviando: false, erro: "O negócio não foi gravado: confira o aviso e tente de novo." });
      return;
    }
    try {
      await submitDealForManagerReview(gravado, mensagem, "agil");
      patch({ document_review_status: "pending" });
      await onReviewChanged?.();
      toast({
        variant: "success",
        title: "Análise enviada para conferência",
        description: "O gerente recebeu o aviso com a sua mensagem.",
      });
      setConferencia(null);
      if (closeOnSave) onClose();
    } catch (err) {
      setConferencia({ enviando: false, erro: describeError(err, "O envio ao gerente não foi feito.") });
    }
  };

  const assumir = async (comentario: string) => {
    if (!batida) return;
    setBatida({ ...batida, enviando: true, erro: null });
    try {
      await assumirNegocioDoCpf(batida.negocio.deal_id, comentario);
      toast({
        variant: "success",
        title: "Negócio assumido",
        description: "Os dados do cliente vieram junto e você é o corretor agora.",
      });
      setBatida(null);
      onClose();
      await onAssumido?.(batida.negocio.deal_id);
    } catch (err) {
      setBatida({ ...batida, enviando: false, erro: describeError(err, "O negócio não foi assumido.") });
    }
  };

  const irParaAnexos = async (mensagem: string) => {
    if (isNew) {
      setConferencia({ enviando: true, erro: null });
      const gravado = await handleSave({ fechar: false });
      if (!gravado) {
        setConferencia({ enviando: false, erro: "O negócio não foi gravado: confira o aviso e tente de novo." });
        return;
      }
    }
    setMensagemEnvio(mensagem);
    setConferencia(null);
    setTab("anexos");
  };

  const tabs: { key: TabKey; label: string }[] = [
    { key: "detalhes", label: "Detalhes" },
    { key: "comentarios", label: comentarios > 0 ? `Comentários (${comentarios})` : "Comentários" },
    { key: "anexos", label: "Anexos" },
    { key: "agenda", label: "Agenda" },
    { key: "historico", label: "Histórico" },
    { key: "cca", label: "CCA" },
  ];

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="glass-strong max-h-[92vh] max-w-2xl overflow-y-auto p-0">
        <DialogTitle className="sr-only">
          {isNew ? "Novo negócio" : `Negócio de ${form.client || "cliente sem nome"}`}
        </DialogTitle>
        {/* Sem ela o Radix avisa no console e, pior, o leitor de tela abre um
            diálogo de ~40 campos anunciando só o título. Diz também por que as
            outras abas nascem cinzas — o que só o `title` do botão explicava. */}
        <DialogDescription className="sr-only">
          {isNew
            ? "Cadastro do negócio em seis abas; comentários, anexos, agenda, histórico e CCA abrem depois de salvar."
            : "Negócio em seis abas: detalhes, comentários, anexos, agenda, histórico e CCA."}
        </DialogDescription>

        {/* `pr-12` reserva o canto para o X do próprio `DialogContent` (fixo em
            `right-4 top-4`): como aqui o conteúdo é `p-0`, sem essa folga as abas
            passam por baixo dele. O X daqui era um segundo botão empilhado.

            Barra centrada como a das demais telas (pedido de 17/09/2026). Quem
            rola é o embrulho e quem centra é a lista (`mx-auto w-fit`), igual ao
            `TabsList` e ao Pipeline: `justify-center` no próprio elemento que
            rola deixaria a primeira aba inalcançável quando as seis não cabem.
            A borda fica no embrulho para continuar atravessando o diálogo. */}
        <div className="overflow-x-auto border-b border-border pl-4 pr-12 pt-4">
          <div
            className="mx-auto flex w-fit gap-4"
            role="tablist"
            aria-label="Seções do negócio"
          >
            {tabs.map((item) => {
              const enabled = item.key === "detalhes" || !isNew;
              return (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.key}
                  disabled={!enabled}
                  title={enabled ? undefined : "Disponível depois de salvar o negócio"}
                  onClick={() => setTab(item.key)}
                  className={cn(
                    "whitespace-nowrap border-b-2 pb-3 text-sm font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    "disabled:cursor-not-allowed disabled:opacity-40",
                    tab === item.key
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-4 p-4">
          {/* O motivo da trava vive AQUI, acima das abas, e não dentro do
              `DealForm`: o "Confirmar alterações" do rodapé está desabilitado
              nas seis abas, e o formulário que explicava o cinza só é montado
              em "Detalhes". O caso concreto é o CCA — o analista preenchia a
              análise inteira, achava o botão apagado e não recebia motivo
              nenhum. Mesmo `lock` que desabilita o botão; uma frase, um lugar. */}
          {lock.reason === "role" && (
            <p className="rounded-xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              Somente leitura. Seu perfil enxerga o negócio, mas o banco recusa a gravação
              (<code>can_edit_deal</code>) — por isso os campos e o botão de confirmar ficam
              desabilitados em vez de aceitar o que seria perdido no salvamento.
            </p>
          )}

          {lock.reason === "month" && (
            <p className="rounded-xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              Mês <strong className="text-foreground">{lock.month}</strong> fechado. O banco
              recusa qualquer gravação neste negócio (<code>deals_guard_closed_month</code>) até um
              administrador reabrir o período — por isso os campos e o botão de confirmar ficam
              desabilitados em vez de aceitar o que seria perdido no salvamento.
            </p>
          )}

          {/* A terceira razão do `lock`, e a que mais confundia: `useDealWriteLock`
              fecha a trava quando a consulta de `closed_months` está pendente ou
              FALHOU, e a frase morava só no `DealForm` — que nem é montado fora de
              "Detalhes". Nas outras cinco abas o botão ficava cinza sem motivo. */}
          {lock.reason === "unknown" && (
            <p className="rounded-xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              Não consegui confirmar se o mês <strong className="text-foreground">{lock.month}</strong>{" "}
              está fechado, então a gravação fica bloqueada em vez de arriscar perder o que for
              digitado. Recarregue a página para tentar de novo.
            </p>
          )}

          {tab === "detalhes" && (
            <>
              <DealForm
                form={form} onChange={patch} field={field}
                people={people} developers={developers} stages={stages} isNew={isNew}
                developerError={developerError}
                onPedirConferencia={() => setConferencia({ enviando: false, erro: null })}
              />
              {isNew && (
                <div className="mt-4 space-y-1.5">
                  <Label htmlFor={field("comentario-inicial")} className="text-eyebrow">Comentário (opcional)</Label>
                  <Textarea
                    id={field("comentario-inicial")}
                    value={comentarioInicial}
                    onChange={(event) => setComentarioInicial(event.target.value)}
                    maxLength={2000}
                    rows={3}
                    placeholder="Ex.: cliente aprovado na Caixa, assinatura marcada para sexta."
                  />
                  <p className="text-xs text-muted-foreground">Entra na aba Comentários quando o negócio for criado.</p>
                </div>
              )}
            </>
          )}

          {tab === "comentarios" && dealId && <DealCommentsPanel dealId={dealId} people={people} />}

          {tab === "anexos" && dealId && (
            <DealDocumentUpload
              dealId={dealId}
              clientName={form.client}
              dealCode={form.code || dealId}
              // O que vale é o gravado (`deal`), não o `form`: trocar a construtora
              // na aba Detalhes sem confirmar ainda deixa o banco sem ela.
              hasDeveloper={Boolean(deal?.developer_id || (criadoId && (form.developer_id || form.developer)))}
              // A MESMA resposta que desabilita os campos: sem ela o gerente
              // clicava "Aprovar e enviar ao CCA" num negócio de mês fechado e
              // recebia a recusa crua de `deals_guard_closed_month` em toast.
              closedMonth={lock.reason === "month" ? lock.month : null}
              // A trava por mês não confirmado desce junto: sem ela "Enviar ao
              // gerente", "Devolver" e "Aprovar e enviar ao CCA" ficavam vivos
              // enquanto o resto do modal já estava travado pelo mesmo `lock`.
              unconfirmedMonth={lock.reason === "unknown" ? lock.month : null}
              onReviewChanged={onReviewChanged}
              mensagemInicial={mensagemEnvio}
            />
          )}

          {tab === "agenda" && dealId && (
            <div className="space-y-4">
              <TaskPanel refType="deal" refId={dealId} />
              <div className="border-t border-border pt-3"><VisitPanel dealId={dealId} /></div>
            </div>
          )}

          {tab === "historico" && dealId && <DealHistoryPanel dealId={dealId} />}

          {tab === "cca" && dealId && <DealCcaPanel dealId={dealId} value={cca} onChange={setCca} />}
        </div>

        <div className="flex justify-end gap-3 border-t border-border p-4">
          {/* Vermelho e verde do rodapé do sistema anterior (pedido de 27/09/2026). */}
          <Button
            variant="outline" onClick={onClose}
            className="border-destructive/70 bg-destructive/10 hover:bg-destructive/20"
          >
            Cancelar
          </Button>
          <Button
            variant="tintSuccess" className="glow-success font-semibold text-success"
            onClick={() => void handleSave()}
            disabled={saving || lock.readOnly || !form.client.trim()}
          >
            {saving ? "Salvando…" : isNew ? "Criar negócio" : "Confirmar alterações"}
          </Button>
        </div>
      </DialogContent>
      {batida && (
        <BatidaCpfDialog
          negocio={batida.negocio}
          enviando={batida.enviando}
          erro={batida.erro}
          onAssumir={(comentario) => void assumir(comentario)}
          onClose={() => setBatida(null)}
        />
      )}
      {conferencia && (
        <ConferenciaGerenteDialog
          cliente={form.client}
          isNew={isNew}
          enviando={conferencia.enviando}
          erro={conferencia.erro}
          onEnviar={(mensagem) => void enviarConferencia(mensagem)}
          onAnexos={(mensagem) => void irParaAnexos(mensagem)}
          onClose={() => setConferencia(null)}
        />
      )}
    </Dialog>
  );
}
