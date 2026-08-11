import { test, expect, db, runTag } from "../support/fixtures";

/**
 * Diário de equipe sem sessão — `/daily/:slug`.
 *
 * A superfície anônima do projeto são exatamente três RPCs (`public_daily_team`,
 * `public_daily_submit`, `public_director_checkpoint`); duas delas são exercidas
 * aqui. O portão é o PIN, guardado como bcrypt em `public_links.pin_hash`.
 *
 * Cenário próprio de propósito: o banco é compartilhado entre agentes e as
 * equipes do seed já têm `daily_reports` de hoje. Escrever nelas destruiria dado
 * de outro teste; então a suíte cria a própria equipe, o próprio link e apaga
 * tudo no fim (a remoção da equipe cascateia link, membro, relatório e entrada).
 */

// Hash bcrypt do PIN "123456". O PIN nunca é gravado em claro (nem no teste), e
// `set_public_link_pin` exige sessão de admin — que o anônimo não tem. Um hash
// bcrypt é autocontido (algoritmo + custo + sal), então vale em qualquer banco.
const PIN = "123456";
const PIN_HASH = "$2a$06$On6loHaQgXqIOl9PmZJkGewH/uNU0GARZ.qwUqc.irdujr38Di1xi";

// Perfil do seed sem equipe ativa. `team_members_one_active` é UNIQUE por perfil
// enquanto `left_at is null`: reaproveitar um corretor já alocado o arrancaria da
// equipe dele e quebraria os testes de visibilidade dos outros agentes.
const EMAIL_MEMBRO = "seed.parceiro@example.invalid";

// Ordem das colunas do formulário, igual à constante FIELDS da tela. Os inputs
// não têm nome acessível — a única âncora estável é a ordem das colunas, que é
// a mesma do cabeçalho visível.
const COLUNAS = [
  "leads", "ligacoes", "coleta_docs", "visitas_agendadas",
  "visitas_realizadas", "analises", "aprovados", "vendas",
] as const;

const tag = runTag();
const slug = `diario-${tag}`;
const slugInativo = `diario-off-${tag}`;

let teamId = "";
let membroId = "";
let membroNome = "";

test.beforeAll(async () => {
  const [membro] = await db.select<{ id: string; full_name: string }>(
    `profiles?email=eq.${encodeURIComponent(EMAIL_MEMBRO)}&select=id,full_name`,
  );
  if (!membro) throw new Error(`perfil ${EMAIL_MEMBRO} não existe — o seed rodou?`);
  membroId = membro.id;
  membroNome = membro.full_name;

  const [equipe] = await db.insert<{ id: string }>("teams", {
    name: `Equipe Diário ${tag}`,
    slug: `equipe-diario-${tag}`,
    active: true,
  });
  teamId = equipe.id;

  await db.insert("team_members", { team_id: teamId, profile_id: membroId });

  await db.insert("public_links", [
    { kind: "daily_team", team_id: teamId, slug, pin_hash: PIN_HASH, active: true },
    // Mesmo PIN, link desativado: prova que "inativo" não vira mensagem própria.
    { kind: "daily_team", team_id: teamId, slug: slugInativo, pin_hash: PIN_HASH, active: false },
  ]);
});

test.afterAll(async () => {
  // teams cascateia public_links, team_members, daily_reports e daily_entries.
  if (teamId) await db.remove(`teams?id=eq.${teamId}`);
});

/** Abre a tela e espera o cartão de PIN — sem `aguardarCarregamento`, que aqui
 *  esbarra no "Carregando equipe..." do título e só devolve depois de 20s. */
async function abrirDiario(page: import("@playwright/test").Page, alvo = slug) {
  await page.goto(`/daily/${alvo}`);
  await expect(page.getByText(/acesso da equipe/i)).toBeVisible();
}

const campoPin = (page: import("@playwright/test").Page) => page.getByPlaceholder("••••••");
const botaoEntrar = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: /entrar na missão/i });

test.describe("diário público", () => {
  test("pede PIN antes de mostrar qualquer dado da equipe", async ({ page }) => {
    await abrirDiario(page);

    await expect(campoPin(page)).toBeVisible();
    await expect(botaoEntrar(page)).toBeVisible();

    // Nada da equipe pode vazar antes do PIN: nem a escala, nem o formulário.
    await expect(page.getByText(membroNome)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /corretores da equipe/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /salvar checkpoint/i })).toHaveCount(0);
  });

  test("PIN incorreto avisa 'PIN incorreto' e mantém a equipe fechada", async ({ page }) => {
    await abrirDiario(page);

    await campoPin(page).fill("999999");
    await botaoEntrar(page).click();

    await expect(page.getByText(/pin incorreto/i)).toBeVisible();
    await expect(campoPin(page)).toBeVisible();
    await expect(page.getByText(membroNome)).toHaveCount(0);
  });

  test("link desativado não ganha mensagem própria — o PIN certo dá a mesma recusa", async ({ page }) => {
    // A `resolve_public_link` devolve NULL para slug inexistente, link inativo,
    // expirado e PIN errado sem distinguir os casos. Distinguir transformaria a
    // tela em oráculo de enumeração de slugs.
    await abrirDiario(page, slugInativo);

    await campoPin(page).fill(PIN);
    await botaoEntrar(page).click();

    await expect(page.getByText(/pin incorreto/i)).toBeVisible();
    await expect(page.getByText(membroNome)).toHaveCount(0);
  });

  test("erro de rede não é confundido com PIN incorreto", async ({ page, context }) => {
    // O erro de infraestrutura tem que sair pela porta dele. Antes, RPC caindo e
    // PIN errado davam a mesma frase, e o gerente ficava redigitando um PIN certo.
    //
    // Queda real de rede em vez de resposta 5xx forjada: 5xx faz o navegador
    // registrar "Failed to load resource" no console e a fixture `semErroDeConsole`
    // reprovaria o teste pelo próprio mock, não pela tela.
    await abrirDiario(page);
    await context.setOffline(true);

    await campoPin(page).fill(PIN);
    await botaoEntrar(page).click();

    await expect(page.getByText(/erro de conexão/i)).toBeVisible();
    await expect(page.getByText(/pin incorreto/i)).toHaveCount(0);

    await context.setOffline(false);
  });

  // Regressão da migration 0009 coberta pela 0026: a RPC atualiza last_seen_at,
  // então precisa ser VOLATILE. Estes cenários provam o caminho positivo e a
  // persistência, não apenas as recusas de PIN.
  test("PIN correto abre a equipe e lista a escala", async ({ page }) => {
    await abrirDiario(page);

    await campoPin(page).fill(PIN);
    await botaoEntrar(page).click();

    await expect(page.getByRole("heading", { name: `Equipe Diário ${tag}` })).toBeVisible();
    await page.getByRole("button", { name: /corretores da equipe/i }).click();
    await expect(page.getByText(membroNome)).toBeVisible();
    await expect(campoPin(page)).toHaveCount(0);
  });

  test("salvar o checkpoint grava em daily_reports e daily_entries", async ({ page }) => {
    await abrirDiario(page);
    await campoPin(page).fill(PIN);
    await botaoEntrar(page).click();

    await page.getByRole("button", { name: /preencher o daily|editar daily/i }).click();

    await page.getByPlaceholder("Seu nome").fill(`Gerente ${tag}`);

    // A equipe do teste tem um corretor só, então os oito campos numéricos da
    // tela são exatamente a linha dele, na ordem das colunas do cabeçalho.
    const numeros = page.locator('input[type="number"]');
    await expect(numeros).toHaveCount(COLUNAS.length);
    await numeros.nth(COLUNAS.indexOf("leads")).fill("7");
    await numeros.nth(COLUNAS.indexOf("analises")).fill("3");
    await numeros.nth(COLUNAS.indexOf("vendas")).fill("1");

    await page.getByRole("button", { name: /salvar checkpoint/i }).click();
    await expect(page.getByText(/checkpoint concluído/i)).toBeVisible();

    // A auditoria já pegou tela que dizia "salvo" sem gravar nada: a asserção
    // que vale é a do banco.
    await expect(async () => {
      const [relatorio] = await db.select<{ id: string; submitted_at: string | null }>(
        `daily_reports?team_id=eq.${teamId}&select=id,submitted_at`,
      );
      expect(relatorio, "daily_reports não recebeu o relatório do dia").toBeTruthy();
      expect(relatorio.submitted_at).not.toBeNull();

      const entradas = await db.select<{ leads: number; analyses_sent: number; sales: number }>(
        `daily_entries?report_id=eq.${relatorio.id}&profile_id=eq.${membroId}&select=leads,analyses_sent,sales`,
      );
      expect(entradas).toHaveLength(1);
      expect(entradas[0]).toMatchObject({ leads: 7, analyses_sent: 3, sales: 1 });
    }).toPass({ timeout: 10_000 });
  });

  test("a tela não oferece gestão de membros — isso é da tela Equipes", async ({ page }) => {
    // A gestão de escala saiu do diário público: um link com PIN não pode
    // admitir nem desligar corretor. O diálogo virou consulta.
    await abrirDiario(page);
    await campoPin(page).fill(PIN);
    await botaoEntrar(page).click();

    await page.getByRole("button", { name: /corretores da equipe/i }).click();

    await expect(page.getByText(membroNome)).toBeVisible();
    await expect(page.getByText(/o gestor logado usa a tela/i)).toBeVisible();

    for (const proibido of [/adicionar/i, /incluir corretor/i, /remover/i, /desligar/i, /salvar/i]) {
      await expect(page.getByRole("button", { name: proibido })).toHaveCount(0);
    }
  });
});
