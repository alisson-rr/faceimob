/**
 * O que a tela pode oferecer sem o banco recusar — lógica pura.
 *
 * Três travas do servidor viviam só no servidor, e a tela oferecia o gesto
 * assim mesmo:
 *
 * 1. **Mês fechado** (`deals_guard_closed_month`, migration 0031). O corretor
 *    continuava com Select de Status 2, alça de arraste e botão de "Perder"
 *    num negócio congelado, e só descobria pelo toast de erro.
 * 2. **`can_exit_stage`** (`deals_guard_stage`, 0020/0028). A matriz nega a
 *    SAÍDA de uma etapa e o front nunca leu essa coluna: hoje corretor e
 *    gerente têm `can_exit = false` em "Aprovado" (medido em 02/09/2026), e os
 *    negócios daquela coluna ofereciam seta e arraste aos dois — sempre com
 *    42501 na volta.
 * 3. **Conferência documental** (0028). Entrar em `approved`/`contract`/
 *    `closed` sem `document_review_status = 'approved'` estoura P0001 sem
 *    nenhum aviso prévio.
 *
 * O admin passa por cima das três no banco (`is_admin()` curto-circuita), então
 * aqui ele também passa — a tela não pode negar o que o banco aceita.
 */
import {
  toNumberOrNull,
  type LegacyDealRecord,
  type SaveLegacyDealInput,
} from "@/integrations/supabase/newSchema";
import { dealMonth } from "./filters";
import type { PipelineStage } from "./stages";

export type DealLock = {
  /** A linha não aceita escrita: Select, agendar e perder ficam desabilitados. */
  locked: boolean;
  /** Sufixo do nome acessível do controle desabilitado — em `title` não serve:
   *  o Button do kit tem `disabled:pointer-events-none` e a dica nunca abre. */
  reason: string;
  /** O mês-base está em `closed_months` (vale inclusive para o admin, que
   *  continua podendo editar — mas precisa VER que o mês está congelado). */
  monthClosed: boolean;
};

export function dealLock(
  deal: LegacyDealRecord,
  opts: { canWrite: boolean; isAdmin: boolean; closedMonths: string[] },
): DealLock {
  const monthClosed = opts.closedMonths.includes(dealMonth(deal));
  if (!opts.canWrite) return { locked: true, reason: " — perfil somente leitura", monthClosed };
  if (!deal.active) return { locked: true, reason: " — negócio encerrado", monthClosed };
  if (monthClosed && !opts.isAdmin) {
    return { locked: true, reason: ` — mês ${dealMonth(deal)} fechado`, monthClosed };
  }
  return { locked: false, reason: "", monthClosed };
}

/** Etapas que a 0028 só libera com a conferência documental aprovada. */
const REQUIRE_APPROVED_REVIEW = ["under_analysis", "approved", "contract", "closed"];

/**
 * Motivo pelo qual a movimentação seria recusada, ou `null` se ela passa.
 *
 * Uma frase só, em pt-BR, para o mesmo toast que já existe — e antes da
 * escrita, não depois do erro.
 */
export function blockedMoveReason(
  deal: LegacyDealRecord,
  stage: PipelineStage,
  opts: {
    isAdmin: boolean;
    canEnterStage: (stageId: string) => boolean;
    canExitStage: (stageId: string) => boolean;
    closedMonths: string[];
  },
): string | null {
  if (!opts.canExitStage(deal.stage_id)) {
    return `Seu perfil não pode tirar um negócio de "${deal.stage_label}".`;
  }
  if (!opts.canEnterStage(stage.id)) {
    return `Seu perfil não pode mover negócios para "${stage.label}".`;
  }
  if (!opts.isAdmin && opts.closedMonths.includes(dealMonth(deal))) {
    return `O mês ${dealMonth(deal)} está fechado. Fale com o administrador para reabrir.`;
  }
  // `under_analysis` fica de fora: mover para lá tem caminho próprio (envia
  // para a conferência do gerente em vez de gravar a etapa).
  if (stage.code !== "under_analysis"
      && REQUIRE_APPROVED_REVIEW.includes(stage.code)
      && deal.document_review_status !== "approved") {
    return `"${stage.label}" só aceita negócio com a documentação aprovada pelo gerente.`;
  }
  return null;
}

/**
 * Campo numérico fora da faixa que os CHECKs da 0006 aceitam, ou `null`.
 *
 * `min`/`max` de `input[type=number]` **não** travam nada aqui: eles só valem
 * na validação de formulário, e o editor de negócio não tem `<form>` nem
 * `checkValidity()`. Digitar "-5" no VGV ou "150" no desconto entrava no state,
 * ia para `legacyDealFields` e só era barrado por `vgv_gross >= 0` /
 * `discount_pct between 0 and 100` — que voltam como 23514 e viram
 * "Um dos campos está fora do valor permitido." num formulário de ~40 campos,
 * sem dizer qual. Aqui a frase nomeia o campo, antes da ida ao banco.
 *
 * Espelha o que `legacyDealFields` de fato grava, inclusive o `?? deal_value`
 * do VGV: validar outra expressão seria aprovar um valor e mandar outro.
 */
export function dealRangeError(
  form: Pick<SaveLegacyDealInput, "vgv_bruto" | "perc_desconto" | "deal_value">,
): string | null {
  const vgv = Number(form.vgv_bruto ?? form.deal_value ?? 0);
  if (!Number.isFinite(vgv) || vgv < 0) {
    return "O VGV bruto precisa ser um número maior ou igual a zero.";
  }
  const desconto = toNumberOrNull(form.perc_desconto);
  if (desconto != null && (desconto < 0 || desconto > 100)) {
    return "O percentual de desconto precisa ficar entre 0 e 100.";
  }
  return null;
}

/**
 * Campo obrigatório que está vazio, ou `null`.
 *
 * **Só a construtora.** "Construtora *" tinha o asterisco e NADA a cobrava: o
 * salvamento só exigia cliente e um participante, e `deals.developer_id` aceita
 * nulo no banco. O negócio entrava, o cartão passava a mostrar "Sem
 * construtora" e — pior — a conferência documental depende de `developer_id`
 * para saber quais documentos pedir, então o negócio sem construtora não tem
 * como entrar na esteira.
 *
 * O `_id`, e não o nome: é ele que o gravador manda para o banco. Um nome
 * digitado sem correspondência no catálogo salvava `developer_id: null` com o
 * texto preenchido na tela.
 *
 * **Empreendimento NÃO é cobrado** — nem aqui, nem na criação. Ele é opcional
 * na outra porta de entrada do mesmo registro (`ConvertLeadDialog` rotula o
 * campo sem asterisco e converte com `project_id: null`), é nulo em negócio
 * de construtora sem catálogo (`developers` sem nenhuma linha em
 * `developer_projects` é caso real) e o Select do formulário não tem digitação
 * livre: cobrá-lo aqui fechava o "Criar negócio" num beco — o operador escolhia
 * a construtora, lia "Esta construtora não tem empreendimento cadastrado" no
 * próprio placeholder e o salvamento recusava por um campo que a tela não tinha
 * como preencher. Duas portas para o mesmo registro passam a nascer com a mesma
 * regra.
 *
 * **Só na CRIAÇÃO** (`form.id` vazio) — a mesma fronteira de `findDuplicateDeal`
 * logo abaixo, e pelo mesmo motivo: a regra é sobre o registro que está sendo
 * AUTORADO, não sobre todo salvamento do registro que já existe. Cobrada em
 * toda gravação, ela trancava a edição de negócio que nasceu incompleto por
 * outro caminho (importação, semente), congelando o registro inteiro por um
 * campo que o editor nem estava tocando.
 */
export function dealRequiredError(
  form: Pick<SaveLegacyDealInput, "id" | "developer" | "developer_id">,
): string | null {
  if (form.id) return null;
  if (!form.developer_id && !(form.developer ?? "").trim()) {
    return "Escolha a construtora: sem ela o negócio não entra na conferência documental.";
  }
  return null;
}

/**
 * Placeholder do Select de empreendimento — três estados, não dois.
 *
 * A expressão inline anunciava "Sem empreendimentos" enquanto NENHUMA
 * construtora tinha sido escolhida — que é como todo negócio novo abre. Num
 * Select desabilitado, isso manda o operador trocar de construtora por causa de
 * um campo que ele ainda nem alimentou. O ramo de erro de rede já tinha sido
 * separado do "não tem nenhum"; faltava separar o "ainda não perguntei" — e
 * dizer, no último ramo, de quem é o problema.
 *
 * O último ramo é informação, não recusa: `dealRequiredError` não cobra
 * empreendimento, então "esta construtora não tem nenhum" descreve o catálogo
 * em vez de anunciar um bloqueio.
 *
 * O primeiro ramo também descreve, e por isso deixou de mandar: "Escolha a
 * construtora antes" abria com as mesmas quatro palavras da recusa de
 * `dealRequiredError` e as duas frases ficam na tela AO MESMO TEMPO no negócio
 * novo sem construtora (o Select de empreendimento nasce desabilitado). Quem
 * lê com os olhos vê a ordem duas vezes com finais diferentes e não sabe se são
 * dois problemas; quem usa leitor de tela ouve o mesmo começo no campo com erro
 * e num campo vizinho que erro nenhum tem. A ordem é UMA — a do campo
 * obrigatório; aqui basta dizer de que este campo depende.
 */
export const projectPlaceholder = (
  { developer, error, count }: { developer?: string | null; error?: string | null; count: number },
): string => {
  if (!(developer ?? "").trim()) return "Depende da construtora";
  if (error) return "Não carregou";
  return count > 0 ? "Escolher" : "Esta construtora não tem empreendimento cadastrado";
};

const chave = (value?: string | null) => (value ?? "").trim().toLowerCase();

/**
 * Negócio ativo igual a este — mesmo cliente, mesmo empreendimento, mesma
 * unidade. `null` quando não há.
 *
 * Só vale na CRIAÇÃO (`form.id` vazio): editar um negócio não pode esbarrar
 * nele mesmo. E só quando a unidade está preenchida — dois negócios do mesmo
 * cliente na mesma construtora são normais (ele pode comprar duas unidades); o
 * que não é normal é a MESMA unidade duas vezes, que é o cadastro repetido.
 * Negócio encerrado não conta: recadastrar depois de uma queda é caso real.
 */
export function findDuplicateDeal(
  deals: LegacyDealRecord[],
  form: { id?: string; client: string; unit?: string | null; project?: string | null },
): LegacyDealRecord | null {
  if (form.id || !chave(form.client) || !chave(form.unit)) return null;
  return deals.find((deal) => deal.active
    && chave(deal.client) === chave(form.client)
    && chave(deal.unit) === chave(form.unit)
    && chave(deal.project) === chave(form.project)) ?? null;
}

/** Etapas de onde os papéis podem TIRAR um negócio (`stage_permissions.can_exit`). */
export const exitableStages = (
  rows: { stage_id: string; role: string; can_exit: boolean }[],
  roles: string[],
): Set<string> => {
  const set = new Set<string>();
  for (const row of rows) {
    if (row.can_exit && roles.includes(row.role)) set.add(row.stage_id);
  }
  return set;
};
