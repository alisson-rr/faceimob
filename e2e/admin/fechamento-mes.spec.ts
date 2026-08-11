import { test, expect, db, aguardarCarregamento, runTag } from "../support/fixtures";
import { mintSession } from "../support/session";
import { resolveTarget } from "../support/target";
import { userFor } from "../support/users";

/**
 * Fechamento de mês — ata de 14/07: "fechamento que não dependa do calendário
 * tradicional… essa ação deverá congelar os dados do período anterior e
 * preparar o sistema para o novo ciclo".
 *
 * O botão fazia três operações soltas no navegador (mover propostas, gravar o
 * mês, encerrar o jogo). Uma falha no meio deixava proposta migrada com o mês
 * ainda aberto. Hoje é `close_month_and_season()`, uma transação só — então o
 * teste cobra os TRÊS efeitos no banco, não o toast.
 *
 * Mês escolhido de propósito: 10/2026 é futuro e não tem negócio de ninguém.
 * Fechar 08/2026 travaria a edição de negócios para os outros specs que rodam
 * ao mesmo tempo neste banco.
 */
const tag = runTag();
const MES = "10/2026";
const ISO = "2026-10-01";
const ISO_SEGUINTE = "2026-11-01";

let negocioAberto: string;
let negocioGanho: string;
let temporadaAntes: string;

async function criarNegocio(rotulo: string, ganho: boolean): Promise<string> {
  const [etapa] = await db.select<{ id: string }>(
    `pipeline_stages?code=eq.${ganho ? "closed" : "proposal"}&select=id`,
  );
  const [deal] = await db.insert<{ id: string }>("deals", {
    stage_id: etapa.id,
    month_base: ISO,
    outcome: ganho ? "won" : "open",
    closed_at: ganho ? new Date().toISOString() : null,
    vgv_gross: 400000,
    status_detail: ganho ? "VENDA" : "PROPOSTA",
    notes: tag,
  });
  await db.insert("deal_clients", {
    deal_id: deal.id,
    ordinal: 1,
    full_name: `${rotulo}-${tag}`,
  });
  return deal.id;
}

test.beforeAll(async () => {
  const jaFechado = await db.select(`closed_months?period=eq.${ISO}&select=period`);
  if (jaFechado.length) {
    throw new Error(`${MES} já está em closed_months — outro teste não limpou; reabra antes de rodar`);
  }

  negocioAberto = await criarNegocio("ABERTO", false);
  negocioGanho = await criarNegocio("GANHO", true);

  const [temporada] = await db.select<{ id: string }>(
    "game_seasons?closed_at=is.null&select=id&order=period_start.desc&limit=1",
  );
  temporadaAntes = temporada.id;
});

/**
 * Devolve o banco ao estado anterior: o mês reabre, a temporada nova some e a
 * original volta a ser a aberta. A ordem importa — o índice único
 * `game_seasons_one_open` não aceita duas temporadas abertas ao mesmo tempo.
 */
test.afterAll(async () => {
  await db.remove(`closed_months?period=eq.${ISO}`);

  const abertas = await db.select<{ id: string }>("game_seasons?closed_at=is.null&select=id");
  for (const s of abertas) {
    if (s.id !== temporadaAntes) await db.remove(`game_seasons?id=eq.${s.id}`);
  }
  await db.remove(`game_season_results?season_id=eq.${temporadaAntes}`);
  await db.update(`game_seasons?id=eq.${temporadaAntes}`, {
    closed_at: null,
    period_end: null,
    closed_by: null,
  });

  await db.remove(`deals?notes=eq.${tag}`);
});

test.describe("fechamento de mês", () => {
  test("fecha o mês, migra as propostas e encerra a temporada na mesma ação", async ({ page }) => {
    await page.goto("/pipeline");
    await aguardarCarregamento(page);

    await page.getByRole("button", { name: /filtrar negócio/i }).click();
    await page.getByPlaceholder("03/2026").fill(MES);

    await page.getByRole("button", { name: /^fechar mês$/i }).click();
    await page.getByRole("button", { name: /confirmar fechamento/i }).click();

    await expect(page.getByText(/mês fechado com sucesso/i)).toBeVisible();

    // (b) o período ficou congelado
    await expect
      .poll(async () => (await db.select(`closed_months?period=eq.${ISO}&select=period`)).length)
      .toBe(1);

    // (a) proposta aberta anda para o mês seguinte; resultado do mês fica
    const [aberto] = await db.select<{ month_base: string }>(
      `deals?id=eq.${negocioAberto}&select=month_base`,
    );
    const [ganho] = await db.select<{ month_base: string }>(
      `deals?id=eq.${negocioGanho}&select=month_base`,
    );
    expect(aberto.month_base).toBe(ISO_SEGUINTE);
    expect(ganho.month_base).toBe(ISO);

    // (c) a temporada do jogo encerrou junto, com o placar congelado
    const [temporada] = await db.select<{ closed_at: string | null; period_end: string | null }>(
      `game_seasons?id=eq.${temporadaAntes}&select=closed_at,period_end`,
    );
    expect(temporada.closed_at).not.toBeNull();
    expect(temporada.period_end).not.toBeNull();

    const congelado = await db.select(
      `game_season_results?season_id=eq.${temporadaAntes}&select=profile_id,rank,points`,
    );
    expect(congelado.length).toBeGreaterThan(0);

    // …e o próximo ciclo já nasceu aberto — sem isso o jogo pararia.
    const abertas = await db.select<{ id: string }>("game_seasons?closed_at=is.null&select=id");
    expect(abertas).toHaveLength(1);
    expect(abertas[0].id).not.toBe(temporadaAntes);
  });

  test("a tela não oferece fechar de novo o mesmo mês", async ({ page }) => {
    expect(await db.select(`closed_months?period=eq.${ISO}&select=period`)).toHaveLength(1);

    await page.goto("/pipeline");
    await aguardarCarregamento(page);

    await page.getByRole("button", { name: /filtrar negócio/i }).click();
    await page.getByPlaceholder("03/2026").fill(MES);

    const botao = page.getByRole("button", { name: new RegExp(`${MES} fechado`, "i") });
    await expect(botao).toBeVisible();
    await expect(botao).toBeDisabled();
  });

  test("o banco recusa o segundo fechamento com mensagem legível", async () => {
    expect(await db.select(`closed_months?period=eq.${ISO}&select=period`)).toHaveLength(1);

    // Chamada com o JWT real do admin (não com service_role): é a mesma
    // credencial que a tela usa, então o que falha aqui falha lá.
    const alvo = resolveTarget();
    const sessao = await mintSession(userFor("admin").email);
    const res = await fetch(`${alvo.supabaseUrl}/rest/v1/rpc/close_month_and_season`, {
      method: "POST",
      headers: {
        apikey: alvo.anonKey,
        Authorization: `Bearer ${sessao.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_period: ISO }),
    });

    expect(res.ok).toBe(false);
    const corpo = (await res.json()) as { message?: string };
    // Mensagem de gente, com o mês: "O mês 10/2026 já está fechado."
    expect(corpo.message ?? "").toMatch(/já está fechado/i);
    expect(corpo.message ?? "").toContain("10/2026");

    // E a recusa não deixou rastro: nada de proposta migrada duas vezes.
    const [aberto] = await db.select<{ month_base: string }>(
      `deals?id=eq.${negocioAberto}&select=month_base`,
    );
    expect(aberto.month_base).toBe(ISO_SEGUINTE);
  });
});
