/**
 * Módulo SDR IA — remarketing, na visão do papel `sdr`.
 *
 * Ata de 14/07: "importação de planilhas com listas de leads antigos para novos
 * disparos via template". O que precisa ser verdade depois do upload:
 *   · a lista existe em `remarketing_lists` com template e agente vinculados;
 *   · o telefone chega normalizado (trigger `remarketing_contacts_normalize`,
 *     que usa `normalize_phone` — o mesmo dedupe dos leads);
 *   · telefone impossível é recusado com aviso, não gravado torto;
 *   · os contadores da tela vêm de `remarketing_list_stats`, não de um chute.
 */
import { test, expect, db, aguardarCarregamento, runTag } from "../support/fixtures";
import { mintSession } from "../support/session";
import { resolveTarget } from "../support/target";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const tag = runTag();

type ListaRow = { id: string; name: string; status: string; template_id: string | null; agent_id: string | null };
type ContatoRow = { id: string; full_name: string | null; phone: string; status: string };

/**
 * A planilha do teste virou CSV.
 *
 * O parser do app trocou de biblioteca (S06: `xlsx` 0.18.5 tinha duas CVEs
 * abertas). A nova, `read-excel-file`, só LÊ — não há como gerar um `.xlsx`
 * aqui sem reintroduzir a dependência que acabou de sair. O `<input>` do
 * remarketing aceita `.xlsx,.xls,.csv` e `parseSheet` decide pelo nome do
 * arquivo, então o CSV percorre o mesmo caminho a partir de `rowsToRecords`.
 * O ramo binário fica coberto pelo teste do fim deste arquivo, que sobe o
 * `.xlsx` de verdade de `__fixtures__`.
 */
const planilha = (linhas: Record<string, string>[]) => {
  const colunas = Object.keys(linhas[0]);
  const celula = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const texto = [colunas.join(","), ...linhas.map((l) => colunas.map((c) => celula(l[c])).join(","))].join("\n");
  return Buffer.from(texto, "utf8");
};

/** Planilha binária de verdade, a mesma que `importSheet.test.ts` usa. */
const XLSX_FIXTURE = () => readFileSync(resolve("src/components/leads/__fixtures__/leads-teste.xlsx"));


const listaChamada = (nome: string) =>
  db.select<ListaRow>(
    `remarketing_lists?name=eq.${encodeURIComponent(nome)}&select=id,name,status,template_id,agent_id`,
  );

const contatosDa = (listId: string) =>
  db.select<ContatoRow>(
    `remarketing_contacts?list_id=eq.${listId}&select=id,full_name,phone,status&order=phone`,
  );

/** O input de arquivo não tem rótulo associado; é o único do painel. */
const seletorDeArquivo = (page: import("@playwright/test").Page) =>
  page.getByRole("tabpanel").locator('input[type="file"]');

const abrirRemarketing = async (page: import("@playwright/test").Page) => {
  await page.goto("/sdr");
  await aguardarCarregamento(page);
  await page.getByRole("tab", { name: /remarketing/i }).click();
  return page.getByRole("tabpanel");
};

test.afterAll(async () => {
  // Contatos caem por cascade quando a lista sai.
  await db.remove(`remarketing_lists?name=like.*${tag}*`);
});

test.describe("SDR · importação de lista", () => {
  test("importa planilha, grava contatos e normaliza o telefone", async ({ page }) => {
    const nome = `Lista ${tag}`;
    const [template] = await db.select<{ id: string; name: string }>(
      "whatsapp_templates?select=id,name&order=created_at&limit=1",
    );
    const [agente] = await db.select<{ id: string; name: string }>(
      "sdr_agents?select=id,name&order=created_at&limit=1",
    );

    const painel = await abrirRemarketing(page);
    await painel.getByPlaceholder("Nome da lista").fill(nome);
    // Template e agente saem de seletores: era campo de texto, e nome digitado
    // errado criava a lista sem template com toast de sucesso.
    await painel.getByRole("combobox").filter({ hasText: /template/i }).click();
    await page.getByRole("option", { name: template.name }).click();
    await painel.getByRole("combobox").filter({ hasText: /agente/i }).click();
    await page.getByRole("option", { name: agente.name }).click();

    await seletorDeArquivo(page).setInputFiles({
      name: "remarketing.csv",
      mimeType: "text/csv",
      buffer: planilha([
        { nome: "Ana Teste", fone: "(11) 98888-1234", campanha: "Retomada Julho" },
        { nome: "Bruno Teste", fone: "11 97777 4321", campanha: "Retomada Julho" },
        { nome: "Carla Teste", fone: "+55 (21) 96666-1111", campanha: "Retomada Julho" },
      ]),
    });

    await expect(page.getByText(/criada com 3 contatos/i)).toBeVisible({ timeout: 20_000 });

    const [lista] = await listaChamada(nome);
    expect(lista, "lista não chegou em remarketing_lists").toBeTruthy();
    expect(lista.template_id).toBe(template.id);
    expect(lista.agent_id).toBe(agente.id);
    expect(lista.status).toBe("draft");

    // Máscara, espaço e DDI repetido colapsam no mesmo formato dos leads.
    const contatos = await contatosDa(lista.id);
    expect(contatos.map((c) => c.phone)).toEqual([
      "5511977774321",
      "5511988881234",
      "5521966661111",
    ]);
    expect(contatos.every((c) => c.status === "pending")).toBe(true);
    expect(contatos.find((c) => c.phone === "5511988881234")?.full_name).toBe("Ana Teste");
  });

  /**
   * O ramo binário do parser, ponta a ponta.
   *
   * Os outros casos deste arquivo entram por CSV; sem este, a troca de
   * biblioteca do S06 passaria no e2e sem nenhum `.xlsx` de verdade ter sido
   * aberto pelo app. O fixture é o mesmo de `importSheet.test.ts` — colunas
   * `Cliente`/`Telefone`, que o `handleFile` do SDR também aceita.
   */
  test("planilha .xlsx de verdade também importa", async ({ page }) => {
    const nome = `Lista xlsx ${tag}`;

    const painel = await abrirRemarketing(page);
    await painel.getByPlaceholder("Nome da lista").fill(nome);
    await seletorDeArquivo(page).setInputFiles({
      name: "leads-teste.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: XLSX_FIXTURE(),
    });

    await expect(page.getByText(/criada com 3 contatos/i)).toBeVisible({ timeout: 20_000 });

    const [lista] = await listaChamada(nome);
    expect(lista, "lista não chegou em remarketing_lists").toBeTruthy();
    const contatos = await contatosDa(lista.id);
    expect(contatos.map((c) => c.phone)).toEqual([
      "5511988770001",
      "5511988770002",
      "5511988770003",
    ]);
    expect(contatos.find((c) => c.phone === "5511988770001")?.full_name).toBe("Ana Paula Ribeiro");
  });

  // O 400 do trigger é o que se quer provocar; o teste cobra o aviso na tela.
  test.describe(() => {
    test.use({ errosEsperados: [/status of 400/i] });

  test("telefone impossível é recusado com aviso visível e não vira contato", async ({ page }) => {
    const nome = `Lista invalida ${tag}`;

    const painel = await abrirRemarketing(page);
    await painel.getByPlaceholder("Nome da lista").fill(nome);
    await seletorDeArquivo(page).setInputFiles({
      name: "invalida.csv",
      mimeType: "text/csv",
      buffer: planilha([
        { nome: "Ok", fone: "(11) 95555-0001", campanha: "x" },
        { nome: "Sem número", fone: "telefone não informado", campanha: "x" },
      ]),
    });

    // O trigger levanta 'Telefone inválido na importação'; a tela precisa dizer.
    await expect(page.getByText(/telefone inválido/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/criada com .* contatos/i)).toHaveCount(0);

    const [lista] = await listaChamada(nome);
    if (lista) expect(await contatosDa(lista.id)).toHaveLength(0);
  });

  });

  // Era defeito: escolher o arquivo antes do nome deixava o input preso com o
  // mesmo arquivo (o browser não dispara `change` para seleção idêntica) e o
  // formulário morria. O valor é limpo assim que o arquivo é capturado.
  test("arquivo escolhido antes do nome não trava o formulário", async ({ page }) => {
    const nome = `Lista tardia ${tag}`;
    const arquivo = {
      name: "tardia.csv",
      mimeType: "text/csv",
      buffer: planilha([{ nome: "Dani Teste", fone: "(11) 94444-0001", campanha: "x" }]),
    };

    const painel = await abrirRemarketing(page);
    await seletorDeArquivo(page).setInputFiles(arquivo);
    await expect(page.getByText(/dê um nome para a lista/i)).toBeVisible();
    await expect(seletorDeArquivo(page)).toHaveValue("");

    await painel.getByPlaceholder("Nome da lista").fill(nome);
    await seletorDeArquivo(page).setInputFiles(arquivo);
    await expect(page.getByText(/criada com 1 contatos/i)).toBeVisible({ timeout: 20_000 });
    expect(await listaChamada(nome)).toHaveLength(1);
  });

  test.describe("atomicidade", () => {
    test.use({ errosEsperados: [/status of 400/i] });

    test("importação que falha não deixa lista vazia no banco", async ({ page }) => {
      const nome = `Lista orfa ${tag}`;

      const painel = await abrirRemarketing(page);
      await painel.getByPlaceholder("Nome da lista").fill(nome);
      await seletorDeArquivo(page).setInputFiles({
        name: "invalida.csv",
        mimeType: "text/csv",
        buffer: planilha([{ nome: "Sem número", fone: "abc", campanha: "x" }]),
      });

      await expect(page.getByText(/telefone inválido/i)).toBeVisible({ timeout: 20_000 });
      expect(await listaChamada(nome)).toHaveLength(0);
    });
  });
});

test.describe("SDR · estatísticas e disparo", () => {
  test("os contadores da lista batem com remarketing_contacts", async ({ page }) => {
    const nome = `Lista stats ${tag}`;
    const [lista] = await db.insert<ListaRow>("remarketing_lists", { name: nome });
    // Todas as linhas com as MESMAS chaves: o PostgREST recusa lote heterogêneo
    // ("All object keys must match").
    await db.insert("remarketing_contacts", [
      { list_id: lista.id, full_name: "Pendente", phone: "11940000001", status: "pending" },
      { list_id: lista.id, full_name: "Enviado", phone: "11940000002", status: "sent" },
      { list_id: lista.id, full_name: "Respondeu", phone: "11940000003", status: "replied" },
      { list_id: lista.id, full_name: "Falhou", phone: "11940000004", status: "failed" },
    ]);

    // A tela lê pelo RPC; o RPC tem que espelhar a tabela.
    const [stats] = await db.rpc<{ total: number; pending: number; sent: number; replied: number; failed: number }[]>(
      "remarketing_list_stats",
      { p_list_id: lista.id },
    );
    expect(stats).toMatchObject({ total: 4, pending: 1, sent: 1, replied: 1, failed: 1 });

    const painel = await abrirRemarketing(page);
    const cartao = painel.locator("div.border.rounded").filter({ hasText: nome });
    await expect(cartao).toContainText("4 contatos");
    await expect(cartao).toContainText("1 pendentes");
    await expect(cartao).toContainText("1 enviados");
    await expect(cartao).toContainText("1 respondidos");
    await expect(cartao).toContainText("1 falhas");

    // O selo sai dos CONTATOS, não da coluna `status`: com 1 enviado e 1
    // respondido a lista ainda estava gravada como 'draft' (o broadcast grava
    // 'draft' sempre que sobra fila), e o selo dizia "rascunho" em inglês.
    await expect(cartao).toContainText("Envio parcial · 1 na fila");
    await expect(cartao).not.toContainText("draft");
  });

  // A edge function aborta sem a credencial da Meta: 5xx no console é o
  // esperado. O que se cobra é que a tela avise e não finja disparo.
  test.describe(() => {
    test.use({ errosEsperados: [/status of 5\d\d/i] });

  test("disparo sem credencial avisa e não marca a lista como enviada", async ({ page }) => {
    const nome = `Lista disparo ${tag}`;
    const [lista] = await db.insert<ListaRow>("remarketing_lists", { name: nome });
    await db.insert("remarketing_contacts", [
      { list_id: lista.id, full_name: "Alvo", phone: "11930000001" },
    ]);

    const painel = await abrirRemarketing(page);
    await painel
      .locator("div.border.rounded")
      .filter({ hasText: nome })
      .getByRole("button", { name: /^disparar$/i })
      .click();

    // A confirmação virou AlertDialog do app: o `confirm()` nativo não dizia
    // para quantos contatos a mensagem sairia, e disparo em massa vai para
    // número de cliente real.
    const confirmacao = page.getByRole("alertdialog");
    await expect(confirmacao).toContainText("1 contato");
    await confirmacao.getByRole("button", { name: /disparar agora/i }).click();

    await expect(page.locator("[data-sonner-toast]")).toBeVisible({ timeout: 25_000 });
    // Nada de "Enviados: 0 | Falhas: 0" fingindo disparo: a function abortou.
    await expect(page.getByText(/^Enviados:/)).toHaveCount(0);

    const [depois] = await listaChamada(nome);
    expect(depois.status).toBe("draft");
    expect((await contatosDa(lista.id))[0].status).toBe("pending");
  });

  });

  /**
   * O toast do disparo diz que "o motivo ficou gravado nele" — e não havia onde
   * ler: `remarketing_contacts.last_error` só existia no banco, e um lote
   * inteiro em 'failed' virava um número na tela. Sem o motivo, o operador não
   * distingue "template não aprovado na Meta" de "número inválido", que é a
   * diferença entre reeditar o template e limpar a planilha.
   */
  test("a lista mostra os contatos e o motivo da falha de cada um", async ({ page }) => {
    const nome = `Lista motivos ${tag}`;
    const [lista] = await db.insert<ListaRow>("remarketing_lists", { name: nome });
    const motivo = `Template name does not exist ${tag}`;
    await db.insert("remarketing_contacts", [
      { list_id: lista.id, full_name: "Contato que falhou", phone: "11930000011", status: "failed", last_error: motivo },
      { list_id: lista.id, full_name: "Contato na fila", phone: "11930000012", status: "pending", last_error: null },
    ]);

    const painel = await abrirRemarketing(page);
    const cartao = painel.locator("div.border.rounded").filter({ hasText: nome });
    await cartao.getByRole("button", { name: /ver contatos/i }).click();

    await expect(cartao.getByText("Contato que falhou")).toBeVisible();
    await expect(cartao.getByText(motivo), "o motivo da falha precisa ser legível na tela").toBeVisible();
    // Situação em pt-BR: 'failed'/'pending' crus não dizem nada a quem opera.
    // `exact`, porque `getByText` casa por SUBSTRING: o selo "Falhou" e a
    // célula "Contato que falhou" são dois textos corretos e diferentes, e sem
    // a âncora o seletor pegava os dois (strict mode). Mesma coisa em
    // "Na fila" × "Contato na fila".
    await expect(cartao.getByText("Falhou", { exact: true })).toBeVisible();
    await expect(cartao.getByText("Na fila", { exact: true })).toBeVisible();

    // O filtro isola o que exige decisão.
    await cartao.getByLabel(/filtrar contatos por situação/i).click();
    await page.getByRole("option", { name: "Falhou" }).click();
    await expect(cartao.getByText("Contato na fila")).toHaveCount(0);
    await expect(cartao.getByText("Contato que falhou")).toBeVisible();
  });

  // Regressão de segurança: autenticação e papel são validados antes de tocar
  // no cofre, inclusive em ambiente sem credencial configurada.
  test("disparo em massa recusa papel sem permissão com 403", async () => {
    const alvo = resolveTarget();
    const sessao = await mintSession("e2e.broker@faceimob.test");
    const [lista] = await db.select<ListaRow>("remarketing_lists?select=id,name,status,template_id,agent_id&limit=1");

    const res = await fetch(`${alvo.supabaseUrl}/functions/v1/sdr-whatsapp-broadcast`, {
      method: "POST",
      headers: {
        apikey: alvo.anonKey,
        Authorization: `Bearer ${sessao.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ list_id: lista.id }),
    });

    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/papel sem permissão/i);
  });
});
