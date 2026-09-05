import { test, expect, db, runTag } from "../support/fixtures";
import { abrirDetalhe, campo, seletor } from "../helpers/negocio";
import { abrirPipelineFiltrado, criarNegocio, limparCenario } from "../matriz/cenario";

/**
 * `can_enter_stage`: mover um card para uma etapa negada tem de FALHAR na tela
 * com motivo legível e NÃO mexer no banco.
 *
 * A matriz semeada já nega "Aprovado" ao corretor (`stage_permissions` só tem
 * linha de broker para incomplete/lead/proposal/visita/análise/perdido). Testar
 * com a matriz de verdade em vez de mexer nela evita brigar com os outros
 * agentes que compartilham este banco.
 */
const tag = runTag();
let negocio: { id: string; cliente: string };
let etapaProposta: string;
let etapaAprovado: string;
let etapaVisita: string;

test.beforeAll(async () => {
  negocio = await criarNegocio(tag, "ETAPA", await db.profileIdOf("broker"));
  [{ id: etapaProposta }] = await db.select<{ id: string }>(
    "pipeline_stages?code=eq.proposal&select=id",
  );
  [{ id: etapaAprovado }] = await db.select<{ id: string }>(
    "pipeline_stages?code=eq.approved&select=id",
  );
  [{ id: etapaVisita }] = await db.select<{ id: string }>(
    "pipeline_stages?code=eq.visit_scheduled&select=id",
  );
});

test.afterAll(async () => {
  await limparCenario(tag);
});

test.describe("corretor · matriz de etapas", () => {
  test("a matriz realmente nega 'Aprovado' ao corretor", async () => {
    const linhas = await db.select<{ can_enter: boolean }>(
      `stage_permissions?role=eq.broker&stage_id=eq.${etapaAprovado}&select=can_enter`,
    );
    // Sem linha = negado (o default do banco é "ninguém além de admin entra").
    expect(linhas.every((l) => !l.can_enter)).toBe(true);
  });

  /**
   * O AVISO mudou de canal, e não por conveniência de teste.
   *
   * Este caso cobrava o toast "Movimentação não permitida", que só existia
   * porque o solte virava escrita e `moveDeal` recusava DEPOIS: o `aria-live`
   * anunciava "Movendo Fulano para Aprovado" e o toast vermelho vinha em
   * seguida — leitor de tela ouvia a confirmação antes da negativa.
   *
   * Hoje o `drop` do `DealsKanban` recusa ANTES de virar escrita e escreve o
   * motivo no mesmo `role="status"`. Quem fixou esse contrato foi
   * `kanban-gesto.spec.ts`, que exige o motivo no `p.sr-only[role="status"]`
   * **e** `toHaveCount(0)` para o toast: as duas asserções não podem coexistir,
   * e a que descreve o código que está no ar é a de lá. Este arquivo passa a
   * cobrar o mesmo canal — o que ele existe para provar é a recusa por
   * `can_enter_stage`, não em qual componente a frase aparece.
   */
  test("arrastar para uma etapa negada avisa e não muda o estágio no banco", async ({ page }) => {
    await abrirPipelineFiltrado(page, tag);

    // A alternância tabela/kanban ganhou nome acessível na Tarefa H (achado
    // X03): dá para pedir pelo papel, em vez de ancorar na classe do ícone.
    await page.getByRole("button", { name: /ver em kanban/i }).click();

    const card = page.getByText(negocio.cliente, { exact: true });
    await expect(card).toBeVisible();

    // A coluna do kanban é uma div sem papel acessível; o gancho estável é a
    // largura fixa do container que carrega os handlers de drop.
    const colunaAprovado = page.locator("div.w-60").filter({ hasText: "Aprovado" });
    await expect(colunaAprovado).toHaveCount(1);

    await card.dispatchEvent("dragstart");
    await colunaAprovado.dispatchEvent("drop");

    // A recusa nomeia a etapa de destino: a matriz nega ENTRAR em "Aprovado",
    // e o corretor pode SAIR de "Proposta" (medido em `stage_permissions`), o
    // que separa esta recusa da outra frase que `blockedMoveReason` produz.
    await expect(page.locator('p.sr-only[role="status"]'))
      .toHaveText(/não pode mover negócios para "Aprovado"/i);

    // O que separa teste útil de teatro: o banco não pode ter mudado.
    await expect(async () => {
      const [linha] = await db.select<{ stage_id: string }>(
        `deals?id=eq.${negocio.id}&select=stage_id`,
      );
      expect(linha.stage_id).toBe(etapaProposta);
    }).toPass({ timeout: 5_000 });
  });

  // Contraprova: sem ela, um card que nunca se move faria o teste acima passar
  // por motivo errado. "Visita Agendada" é permitida ao corretor e não exige
  // documento — as etapas com `requires_document` teriam outro motivo de recusa.
  test("arrastar para uma etapa permitida move o card e grava", async ({ page }) => {
    await abrirPipelineFiltrado(page, tag);
    await page.getByRole("button", { name: /ver em kanban/i }).click();

    const card = page.getByText(negocio.cliente, { exact: true });
    await expect(card).toBeVisible();

    const colunaVisita = page.locator("div.w-60").filter({ hasText: "Visita Agendada" });
    await card.dispatchEvent("dragstart");
    await colunaVisita.dispatchEvent("drop");

    await expect(async () => {
      const [linha] = await db.select<{ stage_id: string }>(
        `deals?id=eq.${negocio.id}&select=stage_id`,
      );
      expect(linha.stage_id).toBe(etapaVisita);
    }).toPass({ timeout: 10_000 });
  });

  /**
   * A outra metade da matriz: `can_exit`.
   *
   * Ela é gravada pela tela de Permissões, cobrada pelo `deals_guard_stage` no
   * banco e nunca era lida pelo front. Hoje corretor e gerente têm
   * `can_exit = false` em "Aprovado" (medido na homologação em 02/09/2026),
   * então o cartão daquela coluna oferecia alça e seta aos dois e SEMPRE
   * devolvia 42501 — a tela prometia um gesto que o banco recusa por princípio.
   */
  test("etapa da qual o corretor não pode sair não oferece alça nem seta", async ({ page }) => {
    const linhas = await db.select<{ can_exit: boolean }>(
      `stage_permissions?role=eq.broker&stage_id=eq.${etapaAprovado}&select=can_exit`,
    );
    expect(linhas.every((l) => !l.can_exit), "a matriz nega a saída de Aprovado ao corretor")
      .toBe(true);

    // "Aprovado" tem `requires_document = true`, e essa checagem do
    // `deals_guard_stage` fica FORA do `if auth.uid() is not null` — vale
    // também para o service_role. Sem documento o próprio setup morria em
    // P0001 ("O estágio exige ao menos um documento anexado antes do avanço") e
    // nenhuma das asserções abaixo chegava a rodar.
    const [tipo] = await db.select<{ id: string; code: string }>(
      "document_types?active=is.true&select=id,code&order=sort_order&limit=1",
    );
    await db.insert("deal_documents", {
      deal_id: negocio.id,
      document_type_id: tipo.id,
      storage_path: `${negocio.id}/e2e-${tag}.pdf`,
      original_name: `${tipo.code}.pdf`,
      stored_name: `${tipo.code}-${tag}.pdf`,
    });

    // `document_review_status` junto porque a 0028 recusa a entrada em
    // "Aprovado" sem a conferência aprovada — e o cenário quer o card LÁ,
    // não a recusa da entrada.
    await db.update(`deals?id=eq.${negocio.id}`, {
      stage_id: etapaAprovado,
      document_review_status: "approved",
    });

    await abrirPipelineFiltrado(page, tag);
    await page.getByRole("button", { name: /ver em kanban/i }).click();

    const cartao = page.getByRole("button", { name: new RegExp(`^${negocio.cliente}`) });
    await expect(cartao).toBeVisible();
    await expect(cartao, "sem alça: o cartão não é arrastável")
      .toHaveAttribute("draggable", "false");
    await expect(cartao).toHaveAccessibleName(/não pode tirar o negócio desta etapa/i);
    await expect(
      page.getByRole("button", { name: new RegExp(`^Mover ${negocio.cliente}`) }),
      "nem os botões de mover",
    ).toHaveCount(0);

    // E se o gesto for forçado, o aviso vem antes da escrita e o banco não muda.
    const colunaContrato = page.locator("div.w-60").filter({ hasText: "Contrato" });
    await cartao.dispatchEvent("dragstart");
    await colunaContrato.dispatchEvent("drop");
    await page.waitForTimeout(1_000);
    const [linha] = await db.select<{ stage_id: string }>(
      `deals?id=eq.${negocio.id}&select=stage_id`,
    );
    expect(linha.stage_id, "o card continua em Aprovado").toBe(etapaAprovado);
  });

  /**
   * A terceira trava do banco espelhada na tela: mês fechado.
   *
   * `deals_guard_closed_month` (0010) recusa INSERT e UPDATE de negócio cujo
   * `month_base` está em `closed_months`, com bypass só para `is_admin()`. A
   * trava existia na LINHA da tabela e no cartão, mas o nome do cliente abre o
   * modal sem ela: o mesmo negócio exibia cadeado e Select desabilitado na
   * tabela e abria o formulário INTEIRO habilitado — o "Salvar" caía em P0001.
   *
   * O mês é criado e desfeito aqui, em `finally`, e é 12/2026 de propósito:
   * mês futuro, sem negócio de ninguém. Fechar 08/2026 travaria a edição para
   * os outros specs que compartilham este banco. O `month_base` é gravado ANTES
   * do fechamento porque depois nem o service_role passa pelo gatilho — ele não
   * é `is_admin()`, `auth.uid()` é nulo.
   */
  test("negócio de mês fechado abre o formulário desabilitado, com o motivo", async ({ page }) => {
    const MES_ISO = "2026-12-01";
    const MES = "12/2026";
    expect(
      await db.select(`closed_months?period=eq.${MES_ISO}&select=period`),
      `${MES} precisa estar aberto no início — outro teste não limpou`,
    ).toHaveLength(0);

    const congelado = await criarNegocio(tag, "MESFECHADO", await db.profileIdOf("broker"));
    await db.update(`deals?id=eq.${congelado.id}`, { month_base: MES_ISO });
    await db.insert("closed_months", { period: MES_ISO });

    try {
      await abrirPipelineFiltrado(page, congelado.cliente);
      const modal = await abrirDetalhe(page, congelado.cliente);

      // O motivo é escrito, não deduzido do cinza dos campos.
      await expect(modal).toContainText(new RegExp(String.raw`Mês\s+${MES}\s+fechado`, "i"));
      await expect(campo(modal, "Bloco | unidade"), "campo de texto travado").toBeDisabled();
      await expect(
        seletor(modal, "Status da venda (Status 2)"),
        "o Select do Radix também — é o `fieldset disabled` que desce em tudo",
      ).toBeDisabled();
    } finally {
      // Antes do `limparCenario` do arquivo: DELETE não passa pelo gatilho de
      // negócio, mas deixar o mês fechado atrapalharia qualquer spec que use
      // 12/2026 depois.
      await db.remove(`closed_months?period=eq.${MES_ISO}`);
      // Passa, sim, pelo gatilho de REGISTRO (`closed_months_log_reopen`, 0076):
      // ele grava reabertura em toda saída da tabela, inclusive nesta limpeza,
      // com `reopened_by` nulo. O `catch` cobre o banco sem a migration.
      await db.remove(`month_reopenings?period=eq.${MES_ISO}`).catch(() => undefined);
    }
  });
});
