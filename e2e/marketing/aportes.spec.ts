/**
 * Aporte de marketing por construtora e mês — visão do papel `marketing`.
 *
 * Ata de 14/07: "o administrador seleciona a construtora e registra o valor
 * aportado mensalmente para monitorar entradas de recursos e custos". No banco
 * é `marketing_investments`, com `unique (developer_id, period)` e `period`
 * travado no primeiro dia do mês.
 *
 * O caso de correção existe porque a tela só listava o mês corrente e só fazia
 * INSERT: lançar de novo um mês antigo batia no unique ("Já existe um registro
 * com esses dados") e a linha antiga nunca aparecia para ser excluída.
 *
 * O item se chama "lançar, corrigir e excluir" e a exclusão não tinha teste
 * nenhum — o auditor contou 10/10 mesmo assim. Ela está aqui agora, junto com
 * a nota (que o caso de correção declarava no tipo e nunca conferia) e com a
 * construtora desativada, cujo nome sumia da lista enquanto o dinheiro dela
 * continuava no total.
 */
import { test, expect, db, aguardarCarregamento, runTag } from "../support/fixtures";

const tag = runTag();

type AporteRow = { id: string; developer_id: string; period: string; amount: number; notes: string | null };

const primeiroDia = (ano: number, mesIndex: number) =>
  `${ano}-${String(mesIndex + 1).padStart(2, "0")}-01`;

const inicioDoMes = () => {
  const hoje = new Date();
  return primeiroDia(hoje.getFullYear(), hoje.getMonth());
};

const mesAnterior = () => {
  const hoje = new Date();
  const d = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  return primeiroDia(d.getFullYear(), d.getMonth());
};

const aportesDoMes = () =>
  db.select<AporteRow>(
    `marketing_investments?period=eq.${inicioDoMes()}&select=id,developer_id,period,amount,notes`,
  );

const aportesDe = (developerId: string) =>
  db.select<AporteRow>(
    `marketing_investments?developer_id=eq.${developerId}&select=id,developer_id,period,amount,notes`,
  );

const emReais = (valor: number) =>
  valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const abrirAportes = async (page: import("@playwright/test").Page) => {
  await page.goto("/marketing");
  await aguardarCarregamento(page);
  await page.getByRole("button", { name: /aporte/i }).click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo).toBeVisible();
  return dialogo;
};

test.afterAll(async () => {
  await db.remove(`marketing_investments?notes=like.*${tag}*`);
  await db.remove(`developers?name=like.*${tag}*`);
});

test.describe("Marketing · aportes", () => {
  test("o botão soma os aportes do mês exatamente como o banco", async ({ page }) => {
    await page.goto("/marketing");
    await aguardarCarregamento(page);

    const total = (await aportesDoMes()).reduce((s, r) => s + Number(r.amount), 0);
    await expect(page.getByRole("button", { name: /aporte/i })).toContainText(emReais(total));
  });

  test("o resumo por construtora reflete marketing_investments", async ({ page }) => {
    const linhas = await aportesDoMes();
    expect(linhas.length, "seed sem aporte no mês corrente — cenário incompleto").toBeGreaterThan(0);

    const construtoras = await db.select<{ id: string; name: string }>("developers?select=id,name");
    const porConstrutora = new Map<string, number>();
    for (const linha of linhas) {
      const nome = construtoras.find((d) => d.id === linha.developer_id)?.name ?? "Sem construtora";
      porConstrutora.set(nome, (porConstrutora.get(nome) ?? 0) + Number(linha.amount));
    }

    const dialogo = await abrirAportes(page);
    for (const [nome, valor] of porConstrutora) {
      await expect(dialogo.getByText(nome, { exact: false }).first()).toBeVisible();
      await expect(dialogo).toContainText(emReais(valor));
    }
    // A lista detalhada tem uma linha por aporte do mês.
    await expect(dialogo.getByText(/nenhum aporte neste mês/i)).toHaveCount(0);
  });

  // A interface usa a mesma decisão da RLS: admin e marketing editam; diretor
  // continua somente leitura.
  test("marketing registra aporte por construtora e mês", async ({ page }) => {
    const [construtora] = await db.insert<{ id: string; name: string }>("developers", {
      name: `Construtora ${tag}`,
      slug: `construtora-${tag}`,
    });

    const dialogo = await abrirAportes(page);
    await dialogo.getByPlaceholder("5000").fill("7300");
    await dialogo.getByRole("combobox").click();
    await page.getByRole("option", { name: construtora.name }).click();
    await dialogo.getByPlaceholder("opcional").fill(`aporte ${tag}`);
    await dialogo.getByRole("button", { name: /salvar/i }).click();

    await expect(async () => {
      const [gravado] = await aportesDe(construtora.id);
      expect(Number(gravado.amount)).toBe(7300);
      expect(gravado.period).toBe(inicioDoMes());
      expect(gravado.notes).toBe(`aporte ${tag}`);
    }).toPass({ timeout: 10_000 });
  });

  test("corrige o valor e a nota de um mês anterior: a linha aparece ao trocar o mês e salvar substitui", async ({ page }) => {
    const [construtora] = await db.insert<{ id: string; name: string }>("developers", {
      name: `Construtora antiga ${tag}`,
      slug: `construtora-antiga-${tag}`,
    });
    const periodo = mesAnterior();
    await db.insert("marketing_investments", {
      developer_id: construtora.id, period: periodo, amount: 1000, notes: `antigo ${tag}`,
    });

    const dialogo = await abrirAportes(page);
    await dialogo.getByLabel("Mês", { exact: true }).fill(periodo.slice(0, 7));
    // O lançamento antigo agora está na lista — dá para ver, corrigir e excluir.
    await expect(dialogo.getByText(construtora.name, { exact: true })).toBeVisible();
    await expect(dialogo).toContainText(emReais(1000));

    // "Editar" traz valor, construtora e nota para o formulário: corrigir a nota
    // sem redigitar tudo era impossível pelas duas telas.
    await dialogo.getByRole("button", { name: `Editar aporte de ${construtora.name}` }).click();
    await expect(dialogo.getByPlaceholder("opcional")).toHaveValue(`antigo ${tag}`);

    await dialogo.getByPlaceholder("5000").fill("2500");
    await dialogo.getByPlaceholder("opcional").fill(`corrigido ${tag}`);
    await dialogo.getByRole("button", { name: /^salvar$/i }).click();

    await expect(dialogo.getByText(/já existe um registro/i)).toHaveCount(0);
    await expect(async () => {
      const linhas = await aportesDe(construtora.id);
      // Continua UM aporte para a dupla (construtora, mês), com o valor novo.
      expect(linhas).toHaveLength(1);
      expect(Number(linhas[0].amount)).toBe(2500);
      expect(linhas[0].period).toBe(periodo);
      expect(linhas[0].notes).toBe(`corrigido ${tag}`);
    }).toPass({ timeout: 10_000 });
  });

  test("excluir apaga do banco, e não só da tela", async ({ page }) => {
    const [construtora] = await db.insert<{ id: string; name: string }>("developers", {
      name: `Construtora excluir ${tag}`,
      slug: `construtora-excluir-${tag}`,
    });
    await db.insert("marketing_investments", {
      developer_id: construtora.id, period: inicioDoMes(), amount: 4500, notes: `excluir ${tag}`,
    });

    const dialogo = await abrirAportes(page);
    await expect(dialogo.getByText(construtora.name, { exact: true })).toBeVisible();

    // O `confirm()` nativo precisa de resposta, senão o clique fica pendurado.
    page.once("dialog", (d) => void d.accept());
    await dialogo.getByRole("button", { name: `Excluir aporte de ${construtora.name}` }).click();

    await expect(async () => {
      expect(await aportesDe(construtora.id)).toHaveLength(0);
    }).toPass({ timeout: 10_000 });
    await expect(dialogo.getByText(construtora.name, { exact: true })).toHaveCount(0);
  });

  /**
   * Desativar a construtora fazia o aporte histórico dela virar "Sem
   * construtora" no popup: a tela só carregava `developers` ativas, mas a FK é
   * RESTRICT e a linha continua no total. O dinheiro ficava e o nome sumia.
   */
  test("construtora desativada continua nomeando o aporte histórico", async ({ page }) => {
    const [construtora] = await db.insert<{ id: string; name: string }>("developers", {
      name: `Construtora inativa ${tag}`,
      slug: `construtora-inativa-${tag}`,
      active: false,
    });
    await db.insert("marketing_investments", {
      developer_id: construtora.id, period: inicioDoMes(), amount: 900, notes: `inativa ${tag}`,
    });

    const dialogo = await abrirAportes(page);
    await expect(dialogo.getByText(construtora.name, { exact: true })).toBeVisible();
    await expect(dialogo.getByText(/^Sem construtora:/)).toHaveCount(0);
  });
});

/** A suíte inteira rodava só em Desktop Chrome; o celular é onde a operação abre. */
test.describe("Marketing · aportes no celular", () => {
  test.use({ viewport: { width: 375, height: 780 } });

  test("o diálogo de aporte cabe em 375 px, sem rolagem horizontal", async ({ page }) => {
    const dialogo = await abrirAportes(page);
    await expect(dialogo.getByPlaceholder("5000")).toBeVisible();

    const transbordo = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    // Quando estoura, dizer QUEM estoura: o número sozinho não distingue um
    // card da página de um campo do diálogo, e a investigação recomeça do zero.
    // Só roda no vermelho — esconder/medir o DOM inteiro custa caro no verde.
    const culpado = transbordo > 1 ? await page.evaluate(() => {
      const sobra = () => document.documentElement.scrollWidth - document.documentElement.clientWidth;
      const nome = (el: Element) => `${el.tagName.toLowerCase()}[${typeof el.className === "string" ? el.className.slice(0, 90) : ""}]`;
      const trilha: string[] = [];
      let atual: Element = document.body;
      // Desce sempre pelo filho que, sozinho, explica a sobra.
      for (let nivel = 0; nivel < 25; nivel++) {
        const culpados = Array.from(atual.children).filter((filho) => {
          const el = filho as HTMLElement;
          const antes = el.style.display;
          el.style.display = "none";
          const semEle = sobra();
          el.style.display = antes;
          return semEle <= 1;
        });
        if (culpados.length !== 1) break;
        trilha.push(nome(culpados[0]));
        atual = culpados[0];
      }
      return trilha.length ? ` — quem estoura: ${trilha.slice(-4).join(" > ")}` : "";
    }) : "";
    expect(transbordo, `a página rola na horizontal em 375 px${culpado}`).toBeLessThanOrEqual(1);
  });

  /**
   * Transbordo VERTICAL, que a medida horizontal não pega: o Radix centraliza o
   * diálogo com `translate-y-[-50%]` e trava o scroll do body, então sem
   * `max-h` + `overflow-y-auto` no `DialogContent` tudo que passa da altura útil
   * — Salvar e Fechar inclusive — fica inalcançável em tela baixa.
   */
  test("o diálogo rola por dentro: dá para chegar em Salvar e em Fechar", async ({ page }) => {
    const dialogo = await abrirAportes(page);

    await dialogo.evaluate((el) => el.scrollTo(0, 0));
    await expect(dialogo.getByRole("button", { name: /^salvar$/i })).toBeInViewport();

    // Um nome acessível por controle: o X do canto se chama "Fechar" (kit) e o
    // do rodapé, "Fechar esta janela". Enquanto os dois se chamavam "Fechar",
    // o leitor de tela anunciava a mesma coisa duas vezes e este seletor casava
    // com os dois. A contagem trava a correção: voltar a chamar o rodapé de
    // "Fechar" faz o teste reprovar de novo.
    await expect(dialogo.getByRole("button", { name: /^fechar$/i })).toHaveCount(1);

    await dialogo.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    // É o do rodapé que precisa estar alcançável: o X é `absolute` dentro da
    // área que rola, então some para cima junto com o conteúdo.
    await expect(dialogo.getByRole("button", { name: "Fechar esta janela" })).toBeInViewport();
  });
});
