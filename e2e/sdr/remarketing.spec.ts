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
import * as XLSX from "xlsx";

const tag = runTag();

type ListaRow = { id: string; name: string; status: string; template_id: string | null; agent_id: string | null };
type ContatoRow = { id: string; full_name: string | null; phone: string; status: string };

const planilha = (linhas: Record<string, string>[]) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), "Contatos");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
};

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
    await painel.getByPlaceholder(/template Meta/).fill(template.name);
    await painel.getByRole("combobox").click();
    await page.getByRole("option", { name: agente.name }).click();

    await seletorDeArquivo(page).setInputFiles({
      name: "remarketing.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
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

  // O 400 do trigger é o que se quer provocar; o teste cobra o aviso na tela.
  test.describe(() => {
    test.use({ errosEsperados: [/status of 400/i] });

  test("telefone impossível é recusado com aviso visível e não vira contato", async ({ page }) => {
    const nome = `Lista invalida ${tag}`;

    const painel = await abrirRemarketing(page);
    await painel.getByPlaceholder("Nome da lista").fill(nome);
    await seletorDeArquivo(page).setInputFiles({
      name: "invalida.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
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

  test.describe("atomicidade", () => {
    test.use({ errosEsperados: [/status of 400/i] });

    test("importação que falha não deixa lista vazia no banco", async ({ page }) => {
      const nome = `Lista orfa ${tag}`;

      const painel = await abrirRemarketing(page);
      await painel.getByPlaceholder("Nome da lista").fill(nome);
      await seletorDeArquivo(page).setInputFiles({
        name: "invalida.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
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

    page.on("dialog", (d) => void d.accept());
    const painel = await abrirRemarketing(page);
    await painel
      .locator("div.border.rounded")
      .filter({ hasText: nome })
      .getByRole("button", { name: /disparar/i })
      .click();

    await expect(page.locator("[data-sonner-toast]")).toBeVisible({ timeout: 25_000 });
    // Nada de "Enviados: 0 | Falhas: 0" fingindo disparo: a function abortou.
    await expect(page.getByText(/^Enviados:/)).toHaveCount(0);

    const [depois] = await listaChamada(nome);
    expect(depois.status).toBe("draft");
    expect((await contatosDa(lista.id))[0].status).toBe("pending");
  });

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
