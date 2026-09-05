import { test, expect, db, runTag, aguardarCarregamento } from "../support/fixtures";

/**
 * Admin · Diário — as AÇÕES de escrita de `/admin/daily-teams`.
 *
 * `e2e/admin/diario-links.spec.ts` cobre a leitura (a lista carrega, o estado do
 * PIN chega à tela). Aqui ficam os quatro caminhos que gravam — criar link,
 * renovar PIN, renovar validade e desativar —, que não tinham nenhuma
 * verificação automatizada: eram exatamente os botões que a auditoria encontrou
 * "nunca exercidos nesta base" (os quatro links da homologação vieram do seed,
 * com `pin_set_at` nulo).
 *
 * Toda asserção termina no BANCO. A tela já teve caso de dizer "salvo" sobre um
 * update barrado por RLS, que volta 204 sem erro — e é justamente por isso que
 * `renewValidity` e `revokeLink` pedem `.select("id")`.
 *
 * Uma equipe por cenário, de propósito: encadear "cria, renova, desativa" na
 * mesma equipe faria a falha de um cenário mentir sobre os outros dois.
 */

const tag = runTag();
const PIN_HASH = "$2a$06$On6loHaQgXqIOl9PmZJkGewH/uNU0GARZ.qwUqc.irdujr38Di1xi";
const DIA = 86_400_000;

// A diretora do seed: equipe sem diretor não entra em checkpoint nenhum e a
// própria tela acusa isso numa faixa de aviso.
const DIRETORA_ID = "10000000-0000-0000-0000-000000000002";

const equipes = {
  criar:     `Equipe Criar Link ${tag}`,
  pin:       `Equipe Renovar PIN ${tag}`,
  validade:  `Equipe Renovar Validade ${tag}`,
  desativar: `Equipe Desativar ${tag}`,
};
const nomeNovaEquipe = `Equipe Nova ${tag}`;

const ids: Record<keyof typeof equipes, string> = {
  criar: "", pin: "", validade: "", desativar: "",
};

const slugPin = `admin-pin-${tag}`;
const slugValidade = `admin-validade-${tag}`;
const slugDesativar = `admin-off-${tag}`;

test.beforeAll(async () => {
  for (const chave of Object.keys(equipes) as (keyof typeof equipes)[]) {
    const [equipe] = await db.insert<{ id: string }>("teams", {
      name: equipes[chave],
      slug: `equipe-${chave}-${tag}`,
      director_id: DIRETORA_ID,
      active: true,
    });
    ids[chave] = equipe.id;
  }

  // Link travado por 5 PINs errados: "Renovar PIN" tem que destravar junto.
  await db.insert("public_links", {
    kind: "daily_team", team_id: ids.pin, slug: slugPin, pin_hash: PIN_HASH, active: true,
    expires_at: new Date(Date.now() + 30 * DIA).toISOString(),
    failed_attempts: 4, locked_until: new Date(Date.now() + 10 * 60_000).toISOString(),
  });

  // Link a dois dias do vencimento E travado: os dois estados que a faixa
  // vermelha da tela mistura em "links não estão abrindo".
  await db.insert("public_links", {
    kind: "daily_team", team_id: ids.validade, slug: slugValidade, pin_hash: PIN_HASH, active: true,
    expires_at: new Date(Date.now() + 2 * DIA).toISOString(),
    failed_attempts: 5, locked_until: new Date(Date.now() + 10 * 60_000).toISOString(),
  });

  await db.insert("public_links", {
    kind: "daily_team", team_id: ids.desativar, slug: slugDesativar, pin_hash: PIN_HASH, active: true,
    expires_at: new Date(Date.now() + 30 * DIA).toISOString(),
    failed_attempts: 0, locked_until: null,
  });
});

test.afterAll(async () => {
  // teams cascateia public_links.
  const lista = Object.values(ids).filter(Boolean);
  if (lista.length) await db.remove(`teams?id=in.(${lista.join(",")})`);
  await db.remove(`teams?name=eq.${encodeURIComponent(nomeNovaEquipe)}`);
});

type LinkRow = {
  id: string; slug: string; active: boolean; has_pin: boolean;
  pin_set_at: string | null; expires_at: string | null;
  locked_until: string | null; failed_attempts: number;
};

const linkDaEquipe = async (teamId: string) => {
  const linhas = await db.select<LinkRow>(
    `public_links?team_id=eq.${teamId}&select=id,slug,active,has_pin,pin_set_at,expires_at,locked_until,failed_attempts&order=created_at.desc`,
  );
  return linhas[0] ?? null;
};

const diasAte = (iso: string | null) =>
  iso === null ? null : Math.round((new Date(iso).getTime() - Date.now()) / DIA);

/**
 * A linha da equipe na lista.
 *
 * O nome está num `<p>` dentro do bloco de identificação; dois níveis acima fica
 * a linha inteira, com o link, o estado do PIN e os botões. Ancorar pelo nome
 * (e não pela ordem) é o que faz o cenário sobreviver a uma equipe nova no meio.
 */
const linhaDaEquipe = (page: import("@playwright/test").Page, nome: string) =>
  page.getByText(nome, { exact: true }).locator("xpath=../..");

/**
 * O botão da linha pelo nome acessível INTEIRO.
 *
 * Os controles da linha dizem de quem é o link ("Desativar o link de Equipe X"),
 * porque numa lista de dez equipes quatro botões chamados só "Desativar"
 * mandam quem usa leitor de tela adivinhar a linha pela ordem do foco. Casar por
 * pedaço (`/desativar/i`) empatava com o botão de validade da MESMA linha, cujo
 * rótulo também carrega o nome da equipe — e é justamente o nome que o cenário
 * usa como palavra-chave. `exact` resolve o empate e, de quebra, é a asserção de
 * que o rótulo continua dizendo a equipe.
 */
const botaoDaLinha = (page: import("@playwright/test").Page, nome: string, rotulo: string) =>
  linhaDaEquipe(page, nome).getByRole("button", { name: rotulo, exact: true });

async function abrirTela(page: import("@playwright/test").Page) {
  await page.goto("/admin/daily-teams");
  await aguardarCarregamento(page);
  await expect(page.getByRole("heading", { name: /diário — links, pins & ips/i })).toBeVisible();
}

test.describe("admin · diário — ações que gravam", () => {
  test("Criar link emite slug sorteado, PIN e 90 dias de validade", async ({ page }) => {
    // O caminho "Criar link" nunca tinha sido exercido nesta base: as quatro
    // linhas de `public_links` vieram do seed, e três das cinco equipes não
    // tinham link nenhum.
    expect(await linkDaEquipe(ids.criar), "a equipe deve começar sem link").toBeNull();

    await abrirTela(page);
    await botaoDaLinha(page, equipes.criar, `Criar link de ${equipes.criar}`).click();

    // O PIN em claro aparece uma vez só, no toast — é a única chance de anotá-lo.
    await expect(page.getByText(/pin gerado/i)).toBeVisible();
    await expect(page.getByText(/anote agora/i)).toBeVisible();

    await expect(async () => {
      const link = await linkDaEquipe(ids.criar);
      expect(link, "o link não foi gravado").not.toBeNull();
      expect(link!.active).toBe(true);
      expect(link!.has_pin, "link público sem PIN é a operação aberta a quem tem a URL").toBe(true);
      expect(link!.pin_set_at, "a troca do PIN tem de ficar datada").not.toBeNull();
      // 90 dias é o prazo da 0062: link sem prazo e sem revogação nunca fecha
      // depois de vazar.
      expect(diasAte(link!.expires_at)).toBeGreaterThanOrEqual(88);
      // Slug sorteado (0033): 32 hexadecimais, não o nome da equipe.
      expect(link!.slug).toMatch(/^[0-9a-f]{32}$/);
    }).toPass({ timeout: 10_000 });
  });

  test("Renovar PIN destrava o link, redata a troca e NÃO muda a URL", async ({ page }) => {
    const antes = (await linkDaEquipe(ids.pin))!;
    // A 0080 carimba `pin_set_at` também no INSERT (antes era só `before update`,
    // e o seed/E2E entravam por fora deixando a tela dizer "sem data de troca"
    // sobre um PIN recém-gravado). Os quatro links do seed continuam com a data
    // nula porque nasceram antes da migration — o que NÃO dá mais para produzir
    // é um link novo sem data, e por isso o cenário afere o carimbo em vez da
    // ausência dele.
    expect(antes.pin_set_at, "a 0080 carimba pin_set_at já no INSERT").not.toBeNull();

    await abrirTela(page);
    await botaoDaLinha(page, equipes.pin, `Renovar PIN de ${equipes.pin}`).click();

    // A confirmação existe porque o PIN atual morre na hora — e agora ela diz
    // também o que NÃO acontece: a URL continua a mesma.
    await expect(page.getByText(/o pin atual para de funcionar imediatamente/i)).toBeVisible();
    await expect(page.getByText(/a url continua a mesma/i)).toBeVisible();
    await page.getByRole("alertdialog").getByRole("button", { name: /renovar pin/i }).click();

    await expect(page.getByText(/pin gerado/i)).toBeVisible();

    await expect(async () => {
      const depois = (await linkDaEquipe(ids.pin))!;
      // Avançar, não só existir: o motivo de a 0080 carimbar do lado do banco é
      // que uma troca por fora deixava a tela anunciando "trocado em <data
      // antiga>" sobre um PIN de hoje.
      expect(
        new Date(depois.pin_set_at!).getTime(),
        "a data da troca não avançou: a tela vai mostrar a data do PIN antigo",
      ).toBeGreaterThan(new Date(antes.pin_set_at!).getTime());
      // PIN novo torna as tentativas anteriores irrelevantes (0033).
      expect(depois.locked_until).toBeNull();
      expect(depois.failed_attempts).toBe(0);
      // O slug é sorteado na criação e o gatilho da 0062 recusa trocá-lo: quem
      // quer aposentar uma URL vazada precisa de Desativar + Criar link.
      expect(depois.slug).toBe(antes.slug);
    }).toPass({ timeout: 10_000 });
  });

  test("Renovar validade repõe os 90 dias e destrava na mesma ação", async ({ page }) => {
    await abrirTela(page);
    const linha = linhaDaEquipe(page, equipes.validade);
    // A saúde do link é o que o admin lê antes de decidir.
    await expect(linha.getByText(/vence em \d+ dias?/i)).toBeVisible();

    await botaoDaLinha(page, equipes.validade, `Renovar validade do link de ${equipes.validade}`).click();

    // Renovar só a data devolvia "renovado" com o link ainda recusando o PIN
    // certo pelos 15 minutos da trava — sucesso para uma ação que não resolveu.
    await expect(page.getByText(/validade renovada e link destravado/i)).toBeVisible();

    await expect(async () => {
      const depois = (await linkDaEquipe(ids.validade))!;
      expect(diasAte(depois.expires_at)).toBeGreaterThanOrEqual(88);
      expect(depois.locked_until).toBeNull();
      expect(depois.failed_attempts).toBe(0);
    }).toPass({ timeout: 10_000 });
  });

  test("Desativar aposenta a URL já entregue", async ({ page }) => {
    await abrirTela(page);
    await botaoDaLinha(page, equipes.desativar, `Desativar o link de ${equipes.desativar}`).click();

    await expect(page.getByText(/a url já entregue para de abrir na hora/i)).toBeVisible();
    await page.getByRole("alertdialog").getByRole("button", { name: /desativar link/i }).click();

    await expect(page.getByText(/link desativado/i)).toBeVisible();

    await expect(async () => {
      const depois = (await linkDaEquipe(ids.desativar))!;
      expect(depois.active, "a URL antiga tem de parar de abrir").toBe(false);
    }).toPass({ timeout: 10_000 });

    // E a linha volta ao estado "sem link": a tela lista só link ativo.
    await expect(
      linhaDaEquipe(page, equipes.desativar).getByText(/sem link público/i),
    ).toBeVisible();
  });

  test("Nova equipe exige diretor e grava o vínculo", async ({ page }) => {
    // Equipe sem diretor não aparece em checkpoint nenhum e, pela 0062, nem o
    // diretor consegue administrar o link dela.
    await abrirTela(page);
    await page.getByRole("button", { name: /nova equipe/i }).click();
    await page.getByLabel(/nome da equipe/i).fill(nomeNovaEquipe);

    await page.getByRole("combobox", { name: /diretor/i }).click();
    await page.getByRole("option", { name: "Daniela Diretora" }).click();

    await page.getByRole("button", { name: /criar equipe/i }).click();
    await expect(page.getByText(/equipe criada/i)).toBeVisible();

    await expect(async () => {
      const [nova] = await db.select<{ id: string; director_id: string | null; slug: string }>(
        `teams?name=eq.${encodeURIComponent(nomeNovaEquipe)}&select=id,director_id,slug`,
      );
      expect(nova, "a equipe não foi gravada").toBeTruthy();
      expect(nova.director_id).toBe(DIRETORA_ID);
      // `teams.slug` é NOT NULL: sem ele o insert era recusado pelo banco.
      expect(nova.slug).toBeTruthy();
    }).toPass({ timeout: 10_000 });

    await expect(linhaDaEquipe(page, nomeNovaEquipe).getByText(/sem link público/i)).toBeVisible();
  });
});
