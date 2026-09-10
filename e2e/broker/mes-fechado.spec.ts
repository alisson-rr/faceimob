import { test, expect, db, aguardarCarregamento, runTag } from "../support/fixtures";
import { mintSession } from "../support/session";
import { resolveTarget } from "../support/target";
import { userFor } from "../support/users";
import type { Page } from "@playwright/test";

/**
 * Mês fechado trava o negócio (ata de 14/07: "congelar os dados do período
 * anterior").
 *
 * A trava é o trigger `deals_guard_closed_month`, que abre exceção só para o
 * admin. O que este teste cobra é que a trava chega à tela como recusa legível
 * E que o banco não muda — a auditoria recente achou tela mostrando "salvo"
 * sem gravação, e o inverso (mostrar erro e gravar assim mesmo) é pior ainda.
 *
 * O controle positivo em mês aberto não é enfeite: sem ele, "não salvou" seria
 * verdade por qualquer motivo — permissão, campo obrigatório, rota errada — e
 * o teste não provaria nada sobre fechamento de mês.
 */
const tag = runTag();
const MES_FECHADO_ISO = "2026-09-01";
/** O mesmo mês como a tela escreve ("MM/AAAA") — derivado, para não divergir. */
const MES_FECHADO_LABEL = `${MES_FECHADO_ISO.slice(5, 7)}/${MES_FECHADO_ISO.slice(0, 4)}`;
const VGV_ORIGINAL = 400000;
const VGV_NOVO = 777000;

let negocioAberto: { id: string; cliente: string };
let negocioFechado: { id: string; cliente: string };

async function criarNegocio(rotulo: string, mesIso: string) {
  const [etapa] = await db.select<{ id: string }>("pipeline_stages?code=eq.proposal&select=id");
  const [construtora] = await db.select<{ id: string }>("developers?select=id&limit=1");
  const [deal] = await db.insert<{ id: string }>("deals", {
    stage_id: etapa.id,
    developer_id: construtora?.id ?? null,
    month_base: mesIso,
    vgv_gross: VGV_ORIGINAL,
    notes: tag,
  });
  const cliente = `${rotulo}-${tag}`;
  await db.insert("deal_clients", { deal_id: deal.id, ordinal: 1, full_name: cliente });
  // O trigger de autofill puxa gerente e diretor da equipe do corretor.
  await db.insert("deal_participants", {
    deal_id: deal.id,
    profile_id: await db.profileIdOf("broker"),
    role: "broker",
  });
  return { id: deal.id, cliente };
}

test.beforeAll(async () => {
  const jaFechado = await db.select(`closed_months?period=eq.${MES_FECHADO_ISO}&select=period`);
  if (jaFechado.length) {
    throw new Error(`09/2026 já está fechado — outro teste não limpou; reabra antes de rodar`);
  }

  // O negócio nasce ANTES do fechamento: o próprio trigger impede criar
  // negócio em mês já fechado, então a ordem aqui não é opcional.
  negocioAberto = await criarNegocio("ABERTO", "2026-08-01");
  negocioFechado = await criarNegocio("FECHADO", MES_FECHADO_ISO);

  await db.insert("closed_months", {
    period: MES_FECHADO_ISO,
    notes: `fechado pelo teste ${tag}`,
  });
});

test.afterAll(async () => {
  await db.remove(`closed_months?period=eq.${MES_FECHADO_ISO}`);
  await db.remove(`deals?notes=eq.${tag}`);
});

async function abrirNegocio(page: Page, cliente: string) {
  await page.goto("/pipeline");
  await aguardarCarregamento(page);
  await page.getByPlaceholder(/buscar cliente/i).fill(cliente);
  await page.getByText(new RegExp(cliente, "i")).first().click();
  await expect(page.getByRole("button", { name: /confirmar alterações/i })).toBeVisible();
}

const vgvGravado = async (id: string) => {
  const [linha] = await db.select<{ vgv_gross: string }>(`deals?id=eq.${id}&select=vgv_gross`);
  return Number(linha.vgv_gross);
};

const alvo = resolveTarget();

/**
 * A mesma escrita que a tela faria, pelo JWT do próprio corretor — chave
 * anônima, RLS e gatilho valendo, sem service_role (que passa por cima da RLS e
 * cujo `auth.uid()` nulo mudaria o caminho dentro do gatilho).
 *
 * Existe porque a tela deixou de tentar: com o "Confirmar alterações"
 * desabilitado, "o VGV continua 400.000" seria verdade mesmo com
 * `deals_guard_closed_month` derrubado. Esta é a única forma de a asserção do
 * banco continuar dizendo alguma coisa.
 */
async function editarComoCorretor(dealId: string, vgv: number) {
  const sessao = await mintSession(userFor("broker").email);
  const res = await fetch(`${alvo.supabaseUrl}/rest/v1/deals?id=eq.${dealId}`, {
    method: "PATCH",
    headers: {
      apikey: alvo.anonKey,
      Authorization: `Bearer ${sessao.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ vgv_gross: vgv }),
  });
  return { status: res.status, corpo: await res.text() };
}

test.describe("corretor · mês fechado", () => {
  test("em mês aberto a edição do próprio negócio é gravada", async ({ page }) => {
    await abrirNegocio(page, negocioAberto.cliente);

    await page.getByLabel("VGV bruto", { exact: true }).fill(String(VGV_NOVO));
    await page.getByRole("button", { name: /confirmar alterações/i }).click();

    await expect(page.getByText(/alterações salvas/i)).toBeVisible();
    await expect.poll(() => vgvGravado(negocioAberto.id)).toBe(VGV_NOVO);
  });

  /**
   * A recusa deixou de esperar o clique.
   *
   * Antes o editor abria inteiro em mês congelado: dava para digitar, salvar e
   * só então levar 400 do `deals_guard_closed_month` num toast vermelho. Hoje
   * `useDealWriteLock` desabilita o formulário E o "Confirmar alterações" — a
   * mesma resposta para os dois —, então o teste cobra a recusa ANTES da
   * gravação.
   *
   * O fim da frase continua sendo cobrado, mas mudou de via: como a tela não
   * tenta mais gravar, o UPDATE é emitido direto pelo JWT do corretor
   * (`editarComoCorretor`) e o que se cobra é o CÓDIGO da recusa. Sem isso a
   * asserção do banco passaria por construção — nenhuma escrita, nenhum jeito
   * de o gatilho reprovar — e o arquivo viraria cópia de `etapas.spec.ts`,
   * que já cobre o formulário desabilitado com o motivo.
   */
  test("em mês fechado a edição é recusada e o banco não muda", async ({ page }) => {
    await abrirNegocio(page, negocioFechado.cliente);

    // Mensagem de gente, com o mês e o que fazer a respeito.
    const aviso = page.getByText(new RegExp(`mês\\s+${MES_FECHADO_LABEL}\\s+fechado`, "i"));
    await expect(aviso, "a recusa nomeia o mês congelado").toBeVisible();
    await expect(aviso, "e diz a quem recorrer").toContainText(/administrador/i);

    const vgv = page.getByLabel("VGV bruto", { exact: true });
    const salvar = page.getByRole("button", { name: /confirmar alterações/i });
    await expect(vgv, "campo de negócio congelado não aceita digitação").toBeDisabled();
    await expect(salvar, "e o salvamento não é oferecido").toBeDisabled();

    // O botão está desabilitado nas CINCO abas, e só "Detalhes" tem formulário:
    // sem esta ida ao CCA, o motivo podia voltar a morar dentro do `DealForm` e
    // o analista de crédito encontraria o botão morto sem explicação.
    await page.getByRole("tab", { name: "CCA" }).click();
    await expect(aviso, "o motivo acompanha o botão nas outras abas").toBeVisible();
    await expect(salvar, "e o botão continua recusando fora de Detalhes").toBeDisabled();

    // A outra metade da frase, que a tela sozinha não prova: o BANCO recusa.
    // Clique em botão desabilitado não emite evento nenhum — se a asserção
    // parasse aqui, ela passaria por construção e a trava do banco poderia
    // sumir sem ninguém ver. Então a escrita é tentada pela via de baixo, com o
    // JWT do corretor, e a recusa é cobrada pelo código do gatilho.
    const recusa = await editarComoCorretor(negocioFechado.id, VGV_NOVO);
    expect(recusa.status, `o gatilho recusa o UPDATE: ${recusa.corpo.slice(0, 200)}`).toBe(400);
    expect(recusa.corpo, "e a recusa é a do mês fechado, não outro erro").toContain("P0001");
    expect(recusa.corpo, "a mensagem nomeia o mês congelado").toContain(MES_FECHADO_LABEL);
    expect(await vgvGravado(negocioFechado.id)).toBe(VGV_ORIGINAL);
  });
});
