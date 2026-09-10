import { test, expect, db, aguardarCarregamento, runTag } from "../support/fixtures";
import {
  abrirNegocio,
  cabecalhosDe,
  comSessao,
  criarCenario,
  limparCenario,
  urlSupabase,
  type Cenario,
} from "./esteira";

/**
 * O catálogo de tipos de documento e o dossiê de quem só acompanha.
 *
 * Duas coisas que a 0059 mudou e que não tinham teste nenhum:
 *   · "Tipos de documento" — até aqui obrigatoriedade, múltiplos arquivos e
 *     `naming_pattern` só mudavam por SQL. O botão é liberado por
 *     `cca.review` e a policy passou a cobrar a MESMA permissão;
 *   · o botão "Anexar" era o único do dossiê sem trava: quem enxerga o negócio
 *     por `can_read_all` (diretor, sócio) e não edita via os nove botões, o
 *     arquivo subia e o insert era barrado depois.
 *
 * O tipo criado aqui nasce INATIVO e é apagado no fim: o banco é compartilhado
 * com outras execuções, e ligar um tipo obrigatório do seed mudaria a contagem
 * de "faltam N obrigatórios" de quem estiver rodando ao lado.
 */

type TipoCatalogo = {
  id: string;
  active: boolean;
  required_for_conversion: boolean;
  allows_multiple: boolean;
};

const lerTipo = async (id: string): Promise<TipoCatalogo> => {
  const [linha] = await db.select<TipoCatalogo>(
    `document_types?id=eq.${id}&select=id,active,required_for_conversion,allows_multiple`,
  );
  return linha;
};

test.describe.serial("CCA · catálogo de documentos e dossiê em leitura", () => {
  const tag = runTag();
  const rotulo = `Tipo E2E ${tag}`;
  let tipoId = "";

  test.beforeAll(async () => {
    const [tipo] = await db.insert<{ id: string }>("document_types", {
      code: `e2e_${tag.replace(/-/g, "_")}`,
      label: rotulo,
      category: "geral",
      active: false,
      sort_order: 98,
    });
    tipoId = tipo.id;
  });

  test.afterAll(async () => {
    if (tipoId) await db.remove(`document_types?id=eq.${tipoId}`);
  });

  test("o catálogo de tipos de documento é editável pela tela", async ({ page }) => {
    await comSessao(page, "cca");
    await page.goto("/cca");
    await aguardarCarregamento(page);

    await page.getByRole("button", { name: /tipos de documento/i }).click();
    // Os mesmos três rótulos se repetem em cada linha: o grupo nomeado é o que
    // diz de qual documento é a caixa que está sendo marcada.
    const linha = page.getByRole("group", { name: rotulo });
    await expect(linha).toHaveCount(1);

    await linha.getByLabel("Ativo", { exact: true }).click();
    await expect(page.getByText("Catálogo atualizado", { exact: true })).toBeVisible();
    await expect.poll(async () => (await lerTipo(tipoId)).active).toBe(true);

    await linha.getByLabel("Aceita vários", { exact: true }).click();
    await expect.poll(async () => (await lerTipo(tipoId)).allows_multiple).toBe(true);

    await linha.getByLabel("Obrigatório", { exact: true }).click();
    await expect.poll(async () => (await lerTipo(tipoId)).required_for_conversion).toBe(true);

    // Desligar um tipo OBRIGATÓRIO some com ele da aba Anexos e destrava o
    // envio ao gerente: a tela tem de dizer isso, não só "salvo".
    await linha.getByLabel("Ativo", { exact: true }).click();
    await expect(page.getByText(/era obrigatório/i)).toBeVisible();
    await expect.poll(async () => (await lerTipo(tipoId)).active).toBe(false);
  });

  /**
   * Diretor enxerga o negócio por `can_read_all` e NÃO o edita: o cenário nasce
   * com o analista de CCA como corretor justamente porque ele não tem equipe —
   * sem equipe o `deal_participants_autofill` não puxa gerente nem diretor, que
   * é o que faria a diretoria entrar no rateio e poder editar de verdade.
   */
  test("quem só acompanha o negócio não vê o botão Anexar", async ({ page }) => {
    const cenario: Cenario = await criarCenario({ dono: "cca", apelido: "Leitura" });
    try {
      await comSessao(page, "director");
      await abrirNegocio(page, cenario.cliente);
      await page.getByRole("tab", { name: "Anexos", exact: true }).click();
      await expect(page.getByText(/anexar documentos/i)).toBeVisible();

      await expect(page.getByRole("button", { name: /^Anexar / })).toHaveCount(0);
      await expect(page.getByText(/anexar é de quem edita o negócio/i).first()).toBeVisible();

      // A tela some com o botão porque o banco recusaria: `deal_documents_insert`
      // cobra `can_edit_deal`. Se um dia o banco passar a permitir, este assert
      // cai junto com o gate — as duas verdades ficam no mesmo lugar.
      const res = await fetch(`${urlSupabase()}/rest/v1/rpc/can_edit_deal`, {
        method: "POST",
        headers: await cabecalhosDe("director"),
        body: JSON.stringify({ p_deal_id: cenario.dealId }),
      });
      expect(await res.json()).toBe(false);
    } finally {
      await limparCenario(cenario);
    }
  });
});
