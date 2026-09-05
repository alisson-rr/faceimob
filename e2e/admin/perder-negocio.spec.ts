/**
 * Perder um negócio (achado F14) — a confirmação com motivo obrigatório.
 *
 * Era um `Switch` em `scale-75` na última coluna: **um clique** gravava
 * `stage=lost` com o motivo fixo "Arquivado manualmente", e a própria tela
 * avisava que negócio encerrado não reabre por ali. A Tarefa H trocou por um
 * `AlertDialog` — e a suíte não cobria nada disso: um `grep` por
 * "perder"/"DISTRATO"/"QUEDA" nos specs não achava um teste sequer. Era a
 * mudança de maior risco do Pipeline sem rede de segurança.
 *
 * Toda asserção termina em `deals`, e não no toast: o caminho antigo mostrava
 * "salvo" sem gravar (regressão de 08/08). E os testes de recusa esperam um
 * segundo ANTES de conferir — provar que nada foi escrito exige dar ao app a
 * chance de escrever.
 *
 * **Onde o motivo é gravado:** `deals.status_detail` guarda o rótulo escolhido e
 * `deals.lost_reason` guarda `"<rótulo> — <observação>"` no mesmo campo. Não há
 * tabela de motivos nem linha própria em `deal_history` — é o que o
 * `LoseDealDialog` manda, conferido no código antes de escrever o teste.
 *
 * **"Confirmar sem motivo" agora existe — e é recusado.** Até o handoff-P o
 * `<Select>` nascia preenchido com "17. DISTRATO" e não havia estado vazio a
 * alcançar: "obrigatório" era, na prática, "pré-selecionado". Aberto pelo botão
 * da linha o campo nasce vazio e o botão fica desabilitado; aberto pelo Status 2
 * da tabela ele chega com o motivo que a pessoa já escolheu lá. Os dois caminhos
 * de entrada estão cobertos, e o motivo gravado nunca é nulo nem vazio.
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { test, db, runTag } from "../support/fixtures";
import {
  abrirDetalhe,
  abrirPipeline,
  buscar,
  campo,
  confirmarModal,
  escolher,
  idDaEtapa,
  limparNegocios,
  linhaDoNegocio,
  negocioPorCliente,
  seletor,
  semearNegocio,
} from "../helpers/negocio";

const marca = runTag();
const nomeCliente = (prefixo: string) => `${prefixo} ${marca}`;

/** Status de partida: nenhum dos quatro rótulos de perda. */
const STATUS_INICIAL = "16. PENDENTE";

let etapaPerdido = "";

test.beforeAll(async () => {
  etapaPerdido = await idDaEtapa("lost");
});

test.afterAll(async () => {
  await limparNegocios(marca);
});

/** Botão da última coluna: tem nome acessível desde a Tarefa H, não é só ícone. */
const botaoPerder = (page: Page, cliente: string): Locator =>
  page.getByRole("button", { name: `Perder o negócio de ${cliente}` });

const confirmacao = (page: Page): Locator => page.getByRole("alertdialog");

/**
 * Escolhe no Status 2 da linha SEM cobrar que o gatilho passe a mostrar a opção.
 *
 * O `escolher()` do helper termina com `toContainText`, e aqui isso reprovaria
 * por motivo certo: o Select da tabela é controlado por `deal.status_detail`, e
 * um rótulo de perda não grava nada — abre a confirmação. O gatilho só muda
 * depois que o banco muda.
 */
async function pedirStatus(gatilho: Locator, opcao: string) {
  await gatilho.click();
  await gatilho.page().getByRole("option", { name: opcao, exact: true }).click();
}

/**
 * Tudo que a perda mexe, num objeto só.
 *
 * Comparar o objeto inteiro (e não campo a campo) é o que pega efeito colateral
 * em coluna que o teste não pensou em listar — um `closed_at` gravado sem
 * confirmação, por exemplo.
 */
async function estadoDe(cliente: string) {
  const negocio = await negocioPorCliente(cliente);
  return {
    stage_id: negocio.stage_id,
    outcome: negocio.outcome,
    status_detail: negocio.status_detail,
    lost_reason: negocio.lost_reason,
    closed_at: negocio.closed_at,
  };
}

/** Janela para o app escrever, se for escrever. Sem ela, "não gravou" só quer dizer "ainda não". */
const JANELA_DE_ESCRITA = 1_000;

test.describe("pipeline · perder negócio", () => {
  test("pedir para perder abre a confirmação e não muda deals", async ({ page }) => {
    const cliente = nomeCliente("Helena Confirmacao");
    await semearNegocio({ cliente, statusDetail: STATUS_INICIAL });
    const antes = await estadoDe(cliente);

    await abrirPipeline(page);
    await buscar(page, cliente);
    await botaoPerder(page, cliente).click();

    // O diálogo diz de qual negócio se trata e o que a perda custa.
    await expect(confirmacao(page)).toContainText(`Encerrar o negócio de ${cliente}?`);
    await expect(confirmacao(page)).toContainText(/deixa de contar no VGV/i);

    // Motivo obrigatório de verdade: por este caminho ninguém escolheu nada
    // ainda, então o campo nasce vazio e não há o que confirmar. Antes ele
    // nascia em "17. DISTRATO" e um Enter distraído gravava um distrato.
    await expect(seletor(confirmacao(page), "Motivo")).toContainText("Escolha o motivo");
    await expect(confirmacao(page).getByRole("button", { name: /encerrar negócio/i })).toBeDisabled();

    await page.waitForTimeout(JANELA_DE_ESCRITA);
    expect(await estadoDe(cliente), "abrir a confirmação não pode encerrar nada").toEqual(antes);
  });

  test("cancelar a confirmação não deixa efeito colateral", async ({ page }) => {
    const cliente = nomeCliente("Igor Cancelamento");
    await semearNegocio({ cliente, statusDetail: STATUS_INICIAL });
    const antes = await estadoDe(cliente);

    await abrirPipeline(page);
    await buscar(page, cliente);
    const statusDaLinha = linhaDoNegocio(page, cliente).getByRole("combobox");

    // Caminho de entrada nº 2: escolher um rótulo de perda no Status 2 da linha.
    await pedirStatus(statusDaLinha, "18. QUEDA");
    await expect(seletor(confirmacao(page), "Motivo")).toContainText("18. QUEDA");

    // Mexer no estado local ANTES de cancelar é o caso que costuma escapar.
    // "19. REPROVADO" de propósito: não é o motivo padrão do diálogo, então
    // reencontrá-lo depois provaria estado vazado.
    await escolher(seletor(confirmacao(page), "Motivo"), "19. REPROVADO");
    await campo(confirmacao(page), "Observação (opcional)").fill("mudei de ideia");
    await confirmacao(page).getByRole("button", { name: /^cancelar$/i }).click();
    await expect(confirmacao(page)).toBeHidden();

    await page.waitForTimeout(JANELA_DE_ESCRITA);
    expect(await estadoDe(cliente), "cancelar não pode gravar nada").toEqual(antes);

    // O Status 2 da linha volta ao que está no banco: o Select é controlado pelo
    // negócio, então o rótulo de perda que abriu o diálogo não fica na tela.
    await expect(statusDaLinha).toContainText(STATUS_INICIAL);

    // E reabrir começa do zero — nada do que foi digitado sobreviveu ao
    // cancelamento. Sem preset o motivo volta a vazio, não ao que foi mexido.
    await botaoPerder(page, cliente).click();
    await expect(campo(confirmacao(page), "Observação (opcional)")).toHaveValue("");
    await expect(seletor(confirmacao(page), "Motivo")).toContainText("Escolha o motivo");
  });

  test("confirmar com motivo encerra o negócio e grava motivo e observação", async ({ page }) => {
    const cliente = nomeCliente("Joana Perda");
    const negocio = await semearNegocio({ cliente, statusDetail: STATUS_INICIAL });
    const observacao = "Cliente comprou com a concorrência";

    await abrirPipeline(page);
    await buscar(page, cliente);
    await botaoPerder(page, cliente).click();

    await escolher(seletor(confirmacao(page), "Motivo"), "18. QUEDA");
    await campo(confirmacao(page), "Observação (opcional)").fill(observacao);
    await confirmacao(page).getByRole("button", { name: /encerrar negócio/i }).click();
    await expect(confirmacao(page)).toBeHidden();
    await expect(page.getByText(/negócio encerrado/i).first()).toBeVisible();

    const depois = await negocioPorCliente(cliente);
    expect(depois.id).toBe(negocio.id);
    expect(depois.stage_id, "a perda move para a etapa Perdido").toBe(etapaPerdido);
    // `outcome` e `closed_at` são do trigger de etapa, não da tela: é o que tira
    // o negócio do VGV e do ranking.
    expect(depois.outcome).toBe("lost");
    expect(depois.closed_at).not.toBeNull();
    expect(depois.status_detail).toBe("18. QUEDA");
    expect(depois.lost_reason).toBe(`18. QUEDA — ${observacao}`);

    // Só está encerrado de verdade se a tela concorda depois de recarregar.
    await abrirPipeline(page);
    await buscar(page, cliente);
    await expect(linhaDoNegocio(page, cliente)).toContainText("Perdido");
    // Perder de novo o que já está perdido não é oferecido: a linha TROCA o
    // botão pelo de reabrir (o caminho do gestor), em vez de deixar um "perder"
    // desabilitado. É a mesma conferência do teste "negócio perdido não reabre
    // pelo botão de agendar visita", que já cobrava a ausência aqui embaixo.
    await expect(botaoPerder(page, cliente)).toHaveCount(0);
    await expect(page.getByRole("button", { name: `Reabrir o negócio de ${cliente}` }))
      .toBeVisible();
    await expect(linhaDoNegocio(page, cliente).getByRole("combobox")).toBeDisabled();
  });

  test("perder pelo Status 2 da tabela passa pela mesma confirmação", async ({ page }) => {
    const cliente = nomeCliente("Karina Distrato");
    await semearNegocio({ cliente, statusDetail: STATUS_INICIAL });
    const antes = await estadoDe(cliente);

    await abrirPipeline(page);
    await buscar(page, cliente);
    await pedirStatus(linhaDoNegocio(page, cliente).getByRole("combobox"), "17. DISTRATO");

    // A regressão que este teste guarda: antes da Tarefa H o rótulo de perda
    // escolhido aqui ia direto para `deals`, sem ninguém confirmar nada.
    await expect(confirmacao(page)).toBeVisible();
    await expect(seletor(confirmacao(page), "Motivo")).toContainText("17. DISTRATO");
    await page.waitForTimeout(JANELA_DE_ESCRITA);
    expect(await estadoDe(cliente)).toEqual(antes);

    await confirmacao(page).getByRole("button", { name: /encerrar negócio/i }).click();
    await expect(confirmacao(page)).toBeHidden();

    // Sem observação o motivo gravado é o rótulo puro — nunca nulo, nunca vazio.
    await expect
      .poll(async () => (await negocioPorCliente(cliente)).lost_reason)
      .toBe("17. DISTRATO");
    const depois = await negocioPorCliente(cliente);
    expect(depois.status_detail).toBe("17. DISTRATO");
    expect(depois.stage_id).toBe(etapaPerdido);
    expect(depois.outcome).toBe("lost");

    // E o negócio sai da conta de ativos que o cabeçalho do Pipeline anuncia.
    const ativos = await db.select(`deals?id=eq.${depois.id}&outcome=eq.open&select=id`);
    expect(ativos).toHaveLength(0);
  });

  test('"19. REPROVADO" na tabela não grava direto — passa pela mesma confirmação', async ({ page }) => {
    // O buraco que este teste fecha: `changeStatus` desviava para a confirmação
    // comparando contra QUEDA/DISTRATO/OFF, e "19. REPROVADO" — um dos quatro
    // motivos que o próprio diálogo oferece — não estava lá. Escolhido aqui, ia
    // direto para `deals` com `lost_reason` nulo e o negócio seguia ATIVO no
    // funil. O mesmo rótulo encerrava pelo diálogo e não encerrava pela tabela.
    const cliente = nomeCliente("Lucas Reprovado");
    await semearNegocio({ cliente, statusDetail: STATUS_INICIAL });
    const antes = await estadoDe(cliente);

    await abrirPipeline(page);
    await buscar(page, cliente);
    await pedirStatus(linhaDoNegocio(page, cliente).getByRole("combobox"), "19. REPROVADO");

    await expect(confirmacao(page)).toBeVisible();
    // E o motivo chega escolhido: quem clicou na tabela já escolheu. Antes o
    // preset era testado com `normalizeStatus`, que devolve null para
    // "REPROVADO" — o diálogo trocaria o motivo por "17. DISTRATO" sem avisar.
    await expect(seletor(confirmacao(page), "Motivo")).toContainText("19. REPROVADO");

    await page.waitForTimeout(JANELA_DE_ESCRITA);
    expect(await estadoDe(cliente), "escolher REPROVADO na tabela não pode gravar nada").toEqual(antes);

    await confirmacao(page).getByRole("button", { name: /encerrar negócio/i }).click();
    await expect(confirmacao(page)).toBeHidden();

    await expect
      .poll(async () => (await negocioPorCliente(cliente)).lost_reason)
      .toBe("19. REPROVADO");
    const depois = await negocioPorCliente(cliente);
    expect(depois.status_detail).toBe("19. REPROVADO");
    expect(depois.stage_id, "confirmado, o reprovado vai para a etapa Perdido").toBe(etapaPerdido);
    expect(depois.outcome).toBe("lost");

    const ativos = await db.select(`deals?id=eq.${depois.id}&outcome=eq.open&select=id`);
    expect(ativos, "reprovado confirmado sai da conta de ativos").toHaveLength(0);
  });

  test("negócio perdido não reabre pelo botão de agendar visita", async ({ page }) => {
    // O buraco que este teste fecha: só o botão de perder olhava `deal.active`.
    // O de calendário, ao lado, continuava ativo — e um clique nele gravava
    // `stage_id` de "Visita agendada", o que faz `deals_guard_stage` devolver
    // `outcome='open'` e limpar `closed_at`. O negócio encerrado voltava para o
    // funil, para o VGV e para o ranking, com o motivo da perda ainda gravado.
    const cliente = nomeCliente("Marta Encerrada");
    const negocio = await semearNegocio({ cliente, statusDetail: STATUS_INICIAL });
    await db.update(`deals?id=eq.${negocio.id}`, {
      stage_id: etapaPerdido,
      outcome: "lost",
      closed_at: new Date().toISOString(),
      lost_reason: "18. QUEDA",
      status_detail: "18. QUEDA",
    });
    const antes = await estadoDe(cliente);

    await abrirPipeline(page);
    await buscar(page, cliente);

    const agendar = page.getByRole("button", { name: `Agendar visita de ${cliente}` });
    await expect(agendar, "encerrado não agenda visita").toBeDisabled();
    // Perder de novo o que já está perdido deixou de ser oferecido: a linha
    // troca o botão pelo de reabrir, que é o caminho do gestor.
    await expect(botaoPerder(page, cliente)).toHaveCount(0);

    // Clique num botão desabilitado não dispara nada; a janela existe para o
    // caso de a trava sumir e o app tentar escrever mesmo assim.
    await agendar.click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(JANELA_DE_ESCRITA);
    expect(await estadoDe(cliente), "o negócio perdido continua perdido").toEqual(antes);
  });

  /**
   * O desfazer que não existia.
   *
   * O próprio diálogo de perda diz "reabrir depois exige um gestor", e não
   * havia tela, botão nem RPC que o gestor usasse: o único caminho era UPDATE
   * direto no banco — o que na prática significa que ninguém desfazia um
   * encerramento por engano.
   */
  test("o admin reabre um negócio encerrado e ele volta ao funil", async ({ page }) => {
    const cliente = nomeCliente("Rita Reaberta");
    const negocio = await semearNegocio({
      cliente, statusDetail: STATUS_INICIAL, brokerId: await db.profileIdOf("broker"),
    });
    await db.update(`deals?id=eq.${negocio.id}`, {
      stage_id: etapaPerdido,
      outcome: "lost",
      closed_at: new Date().toISOString(),
      lost_reason: "18. QUEDA — cliente desistiu",
      status_detail: "18. QUEDA",
    });

    await abrirPipeline(page);
    await buscar(page, cliente);

    await page.getByRole("button", { name: `Reabrir o negócio de ${cliente}` }).click();
    const dialogo = confirmacao(page);
    // A confirmação diz o que vai acontecer, inclusive que o motivo some.
    await expect(dialogo).toContainText("Proposta");
    await expect(dialogo).toContainText("18. QUEDA — cliente desistiu");
    await campo(dialogo, "Por que está reabrindo? (opcional)").fill("encerrado por engano");
    await dialogo.getByRole("button", { name: /reabrir negócio/i }).click();
    await expect(dialogo).toBeHidden();

    await expect.poll(async () => (await negocioPorCliente(cliente)).outcome).toBe("open");
    const depois = await negocioPorCliente(cliente);
    expect(depois.stage_id, "volta para Proposta").toBe(await idDaEtapa("proposal"));
    expect(depois.lost_reason, "o motivo da perda é apagado").toBeNull();
    // O rótulo de perda também sai. Limpar só o `lost_reason` deixava o negócio
    // reaberto exibindo "18. QUEDA" no Status 2 — e o salvamento seguinte lia
    // esse rótulo (`dealStageCodeFor` → `isLossStatus`), mandava o negócio de
    // volta para `lost` e desfazia a reabertura sem ninguém pedir.
    expect(depois.status_detail, "o rótulo de perda também sai do Status 2").toBeNull();
    expect(depois.closed_at, "o gatilho da etapa limpa o fechamento").toBeNull();

    // E o porquê da reabertura fica registrado — `deal_history` é log imútavel
    // escrito por RPC, então a nota só existe se a tela a gravar.
    await expect
      .poll(async () => {
        const linhas = await db.select<{ to_value: string | null }>(
          `deal_history?deal_id=eq.${negocio.id}&kind=eq.comment&select=to_value`,
        );
        return linhas.map((l) => l.to_value).join(" | ");
      })
      .toContain("encerrado por engano");
  });

  /**
   * `saveLegacyDeal` reescrevia `lost_reason` em TODO update: abrir o negócio
   * perdido e confirmar apagava a observação que a confirmação de perda
   * concatenou — e virava `null` para qualquer rótulo que não normalizasse,
   * como "19. REPROVADO".
   */
  test("salvar pelo modal não apaga o motivo da perda", async ({ page }) => {
    const cliente = nomeCliente("Otavio Motivo");
    const negocio = await semearNegocio({
      cliente, statusDetail: "19. REPROVADO", brokerId: await db.profileIdOf("broker"),
    });
    await db.update(`deals?id=eq.${negocio.id}`, {
      stage_id: etapaPerdido,
      outcome: "lost",
      closed_at: new Date().toISOString(),
      lost_reason: "19. REPROVADO — renda insuficiente",
    });

    await abrirPipeline(page);
    await buscar(page, cliente);
    const modal = await abrirDetalhe(page, cliente);
    await campo(modal, "Bloco | unidade").fill("902");
    await confirmarModal(page, modal);

    await expect.poll(async () => (await negocioPorCliente(cliente)).unit).toBe("902");
    const depois = await negocioPorCliente(cliente);
    expect(depois.lost_reason, "o motivo sobrevive ao salvamento")
      .toBe("19. REPROVADO — renda insuficiente");
    expect(depois.outcome, "e o negócio continua encerrado").toBe("lost");
  });

  /**
   * O recorte que o teste acima NÃO cobria — e que é o dos dados reais.
   *
   * Ele semeia `status_detail` junto do `lost_reason`, que é exatamente o único
   * ramo em que a comparação antiga funcionava. Com `status_detail` NULO — o
   * caso dos negócios `…0004` ("Comprou com concorrente.") e `…0025` da
   * homologação — o "Status 2" que a tela mostra é o rótulo DERIVADO de
   * `outcome` ("QUEDA"), que nunca casa com um motivo em texto livre: o
   * primeiro salvamento pelo modal trocava a frase do operador por "QUEDA".
   */
  test("salvar pelo modal não apaga motivo em texto livre (sem Status 2 escolhido)", async ({ page }) => {
    const cliente = nomeCliente("Paula TextoLivre");
    const motivo = "Comprou com concorrente.";
    // Sem `statusDetail`: é assim que os negócios importados chegaram.
    const negocio = await semearNegocio({ cliente, brokerId: await db.profileIdOf("broker") });
    await db.update(`deals?id=eq.${negocio.id}`, {
      stage_id: etapaPerdido,
      outcome: "lost",
      closed_at: new Date().toISOString(),
      lost_reason: motivo,
      status_detail: null,
    });

    await abrirPipeline(page);
    await buscar(page, cliente);
    const modal = await abrirDetalhe(page, cliente);
    // A tela exibe o rótulo deduzido, e não uma escolha de ninguém.
    await expect(seletor(modal, "Status da venda (Status 2)")).toContainText("QUEDA");

    await campo(modal, "Bloco | unidade").fill("1502");
    await confirmarModal(page, modal);

    await expect.poll(async () => (await negocioPorCliente(cliente)).unit).toBe("1502");
    const depois = await negocioPorCliente(cliente);
    expect(depois.lost_reason, "o motivo em texto livre não vira rótulo").toBe(motivo);
    expect(depois.status_detail, "e a dedução não vira escolha gravada").toBeNull();
    expect(depois.outcome).toBe("lost");
  });
});
