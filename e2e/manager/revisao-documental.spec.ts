import { test, expect, db, runTag } from "../support/fixtures";
import {
  abrirDetalhe, abrirPipeline, buscar, idDaEtapa, limparNegocios, linhaDoNegocio, semearNegocio,
} from "../helpers/negocio";
import { cabecalhosDe, urlSupabase } from "../cca/esteira";

const tag = runTag();
const clienteAprovacao = `DOC APROVAR ${tag}`;
const clienteDevolucao = `DOC DEVOLVER ${tag}`;
const clienteForaDoRateio = `DOC FORA RATEIO ${tag}`;
const clienteMesFechado = `DOC MES FECHADO ${tag}`;
let dealAprovacao: string;
let dealDevolucao: string;
let dealForaDoRateio: string;
let dealMesFechado: string;
let brokerId: string;

/** Mês próprio deste arquivo: `closed_months` é estado global do banco de
 *  homologação e outro spec fechando o mesmo período faria os dois brigarem. */
const MES_ISO = "2029-04-01";
const MES_LABEL = "04/2029";

async function prepararPendente(dealId: string) {
  const tipos = await db.select<{ id: string; code: string }>(
    "document_types?active=is.true&required_for_conversion=is.true&select=id,code&order=sort_order",
  );
  await db.insert("deal_documents", tipos.map((tipo) => ({
    deal_id: dealId,
    document_type_id: tipo.id,
    storage_path: `${dealId}/e2e-${tipo.code}.pdf`,
    original_name: `${tipo.code}.pdf`,
    stored_name: `${tipo.code}-${tag}.pdf`,
  })));
  await db.update(`deals?id=eq.${dealId}`, {
    document_review_status: "pending",
    document_review_requested_at: new Date().toISOString(),
    document_review_requested_by: brokerId,
  });
}

test.beforeAll(async () => {
  brokerId = await db.profileIdOf("broker");
  dealAprovacao = (await semearNegocio({ cliente: clienteAprovacao, brokerId })).id;
  dealDevolucao = (await semearNegocio({ cliente: clienteDevolucao, brokerId })).id;
  dealForaDoRateio = (await semearNegocio({ cliente: clienteForaDoRateio, brokerId })).id;
  // A ordem não é opcional: `deals_guard_closed_month` recusa até o INSERT em
  // mês já fechado, então o negócio nasce com o período ainda aberto e o teste
  // congela depois.
  dealMesFechado = (await semearNegocio({
    cliente: clienteMesFechado, brokerId, monthBase: MES_ISO,
  })).id;
  await prepararPendente(dealAprovacao);
  await prepararPendente(dealDevolucao);
  await prepararPendente(dealForaDoRateio);
  await prepararPendente(dealMesFechado);

  // Este gerente lidera a equipe do corretor (então ENXERGA o negócio), mas
  // sai do rateio: quem decide a conferência é gerente do rateio, não da
  // equipe — decisão de 01/09, e até aqui isso só estava no assert SQL.
  await db.remove(`deal_participants?deal_id=eq.${dealForaDoRateio}&role=eq.manager`);
});

test.afterAll(async () => {
  await limparNegocios(tag);
});

test("um gerente vinculado aprova e o negócio entra no CCA", async ({ page }) => {
  await abrirPipeline(page);
  await buscar(page, clienteAprovacao);
  const modal = await abrirDetalhe(page, clienteAprovacao);
  await modal.getByRole("tab", { name: "Anexos", exact: true }).click();

  await expect(modal.getByText("Aguardando gerente", { exact: true })).toBeVisible();
  await modal.getByRole("button", { name: /aprovar e enviar ao cca/i }).click();

  await expect(modal.getByText("Conferido", { exact: true })).toBeVisible();

  /**
   * A auditoria estava no banco (`document_reviewed_by`/`_at`) e invisível na
   * tela: `getDealDocumentReview` lia as duas colunas e nada era renderizado.
   * O nome sai de `deal_participant_names` (0027, security definer) — ler
   * `profiles` direto não serviria, porque o corretor não enxerga o perfil do
   * gerente e a linha voltaria vazia justamente para quem precisa dela.
   */
  await expect(modal.getByText("Conferido por", { exact: true })).toBeVisible();
  await expect(modal.getByText(/E2E Gerente · \d{2}\/\d{2}\/\d{4}/)).toBeVisible();

  const analysisStageId = await idDaEtapa("under_analysis");
  await expect.poll(async () => {
    const [deal] = await db.select<{ document_review_status: string; stage_id: string; status_detail: string | null }>(
      `deals?id=eq.${dealAprovacao}&select=document_review_status,stage_id,status_detail`,
    );
    return deal;
  }).toEqual({
    document_review_status: "approved",
    stage_id: analysisStageId,
    // Escrito pelo banco na entrada do caso na esteira (migration 0037) —
    // ninguém escolheu esse rótulo no Select.
    status_detail: "13. ESTEIRA AGIL",
  });

  const cases = await db.select<{ id: string }>(`cca_cases?deal_id=eq.${dealAprovacao}&select=id`);
  expect(cases).toHaveLength(1);

  // A tabela mostra o rótulo depois de recarregar: é o que o gerente vê ao
  // voltar para a lista, sem ter mexido no Status 2.
  await page.reload();
  await abrirPipeline(page);
  await buscar(page, clienteAprovacao);
  await expect(linhaDoNegocio(page, clienteAprovacao).getByRole("combobox")).toContainText("13. ESTEIRA AGIL");
});

test("gerente só devolve com motivo e o corretor é notificado", async ({ page }) => {
  const motivo = `Documento ilegível ${tag}`;
  await abrirPipeline(page);
  await buscar(page, clienteDevolucao);
  const modal = await abrirDetalhe(page, clienteDevolucao);
  await modal.getByRole("tab", { name: "Anexos", exact: true }).click();

  const devolver = modal.getByRole("button", { name: "Devolver", exact: true });
  await expect(devolver).toBeDisabled();
  await modal.getByRole("textbox", { name: "Motivo da devolução" }).fill(motivo);
  await expect(devolver).toBeEnabled();
  await devolver.click();

  await expect(modal.getByText("Devolvido", { exact: true })).toBeVisible();
  await expect(modal.getByText(motivo, { exact: true })).toBeVisible();
  // Quem devolveu é a primeira pergunta de quem recebe a devolução.
  await expect(modal.getByText("Devolvido por", { exact: true })).toBeVisible();
  await expect.poll(async () => {
    const rows = await db.select<{ body: string }>(
      `notifications?profile_id=eq.${brokerId}&kind=eq.document_review_returned&body=eq.${encodeURIComponent(motivo)}&select=body`,
    );
    return rows.length;
  }).toBe(1);
});

/**
 * Quem aprova é gerente do RATEIO. O gerente da equipe que não está no negócio
 * não decide — e as duas pontas precisam concordar: o botão some para ele E o
 * banco recusa a chamada direta. "Os dois falham em silêncio" seria o defeito.
 */
test("gerente fora do rateio não vê o botão nem passa pela RPC", async ({ page }) => {
  await abrirPipeline(page);
  await buscar(page, clienteForaDoRateio);
  const modal = await abrirDetalhe(page, clienteForaDoRateio);
  await modal.getByRole("tab", { name: "Anexos", exact: true }).click();

  await expect(modal.getByText("Aguardando gerente", { exact: true })).toBeVisible();
  await expect(modal.getByRole("button", { name: /aprovar e enviar ao cca/i })).toHaveCount(0);
  await expect(modal.getByRole("button", { name: "Devolver", exact: true })).toHaveCount(0);
  await expect(modal.getByText(/aguardando a decisão de um gerente vinculado/i)).toBeVisible();

  const resposta = await fetch(`${urlSupabase()}/rest/v1/rpc/review_deal_documents`, {
    method: "POST",
    headers: await cabecalhosDe("manager"),
    body: JSON.stringify({ p_deal_id: dealForaDoRateio, p_approve: true }),
  });
  expect(resposta.ok).toBe(false);

  const [deal] = await db.select<{ document_review_status: string }>(
    `deals?id=eq.${dealForaDoRateio}&select=document_review_status`,
  );
  expect(deal.document_review_status).toBe("pending");
});

/**
 * Mês fechado trava as TRÊS gravações em `deals` da aba, não duas.
 *
 * `review_deal_documents(p_approve=false)` grava `document_review_status =
 * 'returned'` em `deals` (0028) e passa pelo mesmo `deals_guard_closed_month`
 * (0010, `before insert or update`, isento só para `is_admin()`) que já barrava a
 * aprovação. "Devolver" ficou de fora da trava por um tempo: o gerente lia o
 * motivo escrito acima, via "Aprovar" apagado e "Devolver" aceso, clicava e
 * levava a recusa crua do gatilho em toast — o defeito que a trava do irmão
 * existe para eliminar. Aqui as duas pontas concordam: o botão apaga E a RPC
 * chamada por fora do navegador é recusada.
 */
test("mês fechado desabilita devolver e aprovar, com o motivo escrito", async ({ page }) => {
  expect(
    await db.select(`closed_months?period=eq.${MES_ISO}&select=period`),
    `${MES_LABEL} precisa começar aberto — outro teste não limpou`,
  ).toEqual([]);
  await db.insert("closed_months", { period: MES_ISO, notes: `fechado pelo teste ${tag}` });

  try {
    await abrirPipeline(page);
    await buscar(page, clienteMesFechado);
    const modal = await abrirDetalhe(page, clienteMesFechado);
    await modal.getByRole("tab", { name: "Anexos", exact: true }).click();

    // O motivo primeiro: botão cinza sem frase é o defeito que esta tela evita.
    await expect(modal.getByText(new RegExp(`mês ${MES_LABEL} fechado`, "i")).first()).toBeVisible();

    // O motivo preenchido isola a causa: sem ele "Devolver" já nasceria cinza
    // por falta de texto, e o teste passaria pelo motivo errado.
    await modal.getByRole("textbox", { name: "Motivo da devolução" }).fill(`Mês congelado ${tag}`);
    await expect(modal.getByRole("button", { name: "Devolver", exact: true })).toBeDisabled();
    await expect(modal.getByRole("button", { name: /aprovar e enviar ao cca/i })).toBeDisabled();

    // E o banco concorda com a tela: a mesma devolução por fora é recusada.
    const resposta = await fetch(`${urlSupabase()}/rest/v1/rpc/review_deal_documents`, {
      method: "POST",
      headers: await cabecalhosDe("manager"),
      body: JSON.stringify({
        p_deal_id: dealMesFechado, p_approve: false, p_reason: `Mês congelado ${tag}`,
      }),
    });
    expect(resposta.ok).toBe(false);

    const [deal] = await db.select<{ document_review_status: string }>(
      `deals?id=eq.${dealMesFechado}&select=document_review_status`,
    );
    expect(deal.document_review_status).toBe("pending");
  } finally {
    // `closed_months` é estado global: o mês volta a abrir mesmo se a asserção
    // acima falhar, senão o próximo spec herda um período congelado.
    await db.remove(`closed_months?period=eq.${MES_ISO}`);
  }
});
