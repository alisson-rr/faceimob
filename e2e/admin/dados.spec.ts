/**
 * Dados e cadastro de construtora na visão do ADMIN.
 *
 * Por que existe: /data só era exercitado pelo papel `marketing`
 * (o playwright.config.ts casa os specs pelo diretório do papel), e /admin/developers só tinha
 * o smoke de `rotas-positivas` conferindo que a rota abre com o título. As duas
 * telas escrevem em tabela que a operação inteira lê — aporte de mídia e a
 * construtora para onde o dossiê de crédito é enviado — e nenhuma tinha teste
 * de comportamento.
 *
 * O e-mail da construtora é o caso mais caro: `submit_deal_for_analysis` copia
 * `developers.submission_email` para `developer_submissions.to_email` e a edge
 * `submission-dispatch` manda o dossiê pelo Brevo para esse endereço. Um e-mail
 * torto não dá erro em lugar nenhum — o dossiê só não chega.
 */
import { test, expect, db, aguardarCarregamento, runTag } from "../support/fixtures";
import { mintSession, storageStateFor } from "../support/session";
import { E2E_USERS, type RoleKey } from "../support/users";
import type { Browser } from "@playwright/test";

const tag = runTag();

/** Contexto com a sessão REAL de outro papel: JWT de verdade, RLS valendo. */
async function abrirComo(browser: Browser, baseURL: string | undefined, key: RoleKey) {
  if (!baseURL) throw new Error("baseURL do Playwright ausente");
  const usuario = E2E_USERS.find((u) => u.key === key);
  if (!usuario) throw new Error(`papel E2E desconhecido: ${key}`);
  const contexto = await browser.newContext({
    baseURL,
    storageState: storageStateFor(await mintSession(usuario.email), baseURL),
  });
  return { contexto, pagina: await contexto.newPage() };
}

type AporteRow = { id: string; developer_id: string; period: string; amount: number; notes: string | null };
type DevRow = { id: string; name: string; flow: string; submission_email: string | null; contact_name: string | null };

const inicioDoMes = () => {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-01`;
};

const construtoraPorNome = (nome: string) =>
  db.select<DevRow>(`developers?name=eq.${encodeURIComponent(nome)}&select=id,name,flow,submission_email,contact_name`);

test.afterAll(async () => {
  await db.remove(`marketing_investments?notes=like.*${tag}*`);
  await db.remove(`developer_projects?name=like.*${tag}*`);
  await db.remove(`developers?name=like.*${tag}*`);
  await db.remove(`useful_links?label=like.*${tag}*`);
});

/**
 * /data quando a consulta de construtoras não responde.
 *
 * Sem essa lista NADA da aba Marketing funciona: o nome de cada aporte vira
 * travessão, o seletor de Construtora fica sem opção (e o Salvar recusa com
 * "Preencha valor e construtora", que é o motivo errado) e toda linha de
 * planilha é marcada como "construtora não cadastrada" — acusando a planilha de
 * um defeito que é da tela. Antes o efeito só disparava um toast, que some em
 * segundos, e a tela mentida ficava.
 */
test.describe("Admin · /data sem a lista de construtoras", () => {
  // A rejeição é PROVOCADA: o "Failed to load resource" é a prova de que ela
  // aconteceu. Um RegExp só, com alternância — ver a armadilha em fixtures.ts.
  test.use({ errosEsperados: [/Failed to load resource|ERR_FAILED|Failed to fetch/i] });

  test("a tela diz que a lista caiu e bloqueia lançar e importar aporte", async ({ page }) => {
    // Regex e não glob: `**/developers*` pegaria `developer_projects` e
    // `developer_submissions` junto, e a tela sob teste não é essa.
    const rota = /\/rest\/v1\/developers\?/;
    await page.route(rota, (route) => route.abort());

    await page.goto("/data");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: "Marketing" }).click();

    const aviso = page.getByText("Não consegui carregar as construtoras");
    await expect(aviso).toBeVisible();

    // O formulário sai de cena: com o seletor vazio ele só saberia recusar.
    await expect(page.getByRole("button", { name: /salvar aporte/i })).toHaveCount(0);
    // E a caixa de importação também, com o motivo escrito no lugar dela.
    await expect(page.getByText(/toda linha da planilha seria recusada/i)).toBeVisible();

    // A recarga é oferecida, e com a rota de volta a tela se conserta sozinha.
    // A MESMA referência: `unroute` compara por identidade, e dois literais
    // iguais de RegExp são objetos diferentes.
    await page.unroute(rota);
    await page.getByRole("button", { name: "Tentar de novo" }).first().click();
    await expect(page.getByRole("button", { name: /salvar aporte/i })).toBeVisible();
    await expect(aviso).toHaveCount(0);
  });
});

test.describe("Admin · dados de marketing", () => {
  /**
   * O ramo de escrita do aporte é `admin OU marketing`, espelhando
   * `marketing_investments_write`. Só o marketing era exercitado: se alguém
   * trocasse a condição por `roles.includes("marketing")`, o admin perdia o
   * formulário e nenhum teste reclamava.
   */
  test("o administrador lança aporte com nota, e o banco confirma", async ({ page }) => {
    const [construtora] = await db.insert<{ id: string; name: string }>("developers", {
      name: `Construtora Admin ${tag}`,
      slug: `construtora-admin-${tag}`,
    });

    await page.goto("/data");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: "Marketing" }).click();

    await page.getByLabel("Valor do aporte").fill("5100");
    await page.getByLabel("Construtora", { exact: true }).click();
    await page.getByRole("option", { name: construtora.name }).click();
    await page.getByLabel("Nota do aporte").fill(`admin ${tag}`);
    await page.getByRole("button", { name: /salvar aporte/i }).click();

    await expect(async () => {
      const [gravado] = await db.select<AporteRow>(
        `marketing_investments?developer_id=eq.${construtora.id}&select=id,developer_id,period,amount,notes`,
      );
      expect(gravado, "aporte do admin não chegou em marketing_investments").toBeTruthy();
      expect(Number(gravado.amount)).toBe(5100);
      expect(gravado.period).toBe(inicioDoMes());
      expect(gravado.notes).toBe(`admin ${tag}`);
    }).toPass({ timeout: 10_000 });

    // E some da tela quando é excluído — o `delete` confere o retorno, então
    // recusa do RLS não passa por sucesso.
    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: `Excluir aporte de ${construtora.name}` }).click();
    await expect(async () => {
      const linhas = await db.select<AporteRow>(
        `marketing_investments?developer_id=eq.${construtora.id}&select=id,developer_id,period,amount,notes`,
      );
      expect(linhas).toHaveLength(0);
    }).toPass({ timeout: 10_000 });
  });

  // Antes o usuário descobria o cabeçalho esperado lendo a descrição do card.
  test("o modelo de planilha de aportes pode ser baixado", async ({ page }) => {
    await page.goto("/data");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: "Marketing" }).click();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /baixar modelo/i }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("modelo-aportes-marketing.csv");
  });
});

test.describe("Admin · construtoras", () => {
  test("clicar em Adicionar sem nome responde, em vez de não fazer nada", async ({ page }) => {
    await page.goto("/admin/developers");
    await aguardarCarregamento(page);

    await page.getByRole("button", { name: /adicionar/i }).click();
    await expect(page.getByText(/informe o nome da construtora/i)).toBeVisible();
  });

  /**
   * O input `type="email"` fora de `<form>` não valida nada e a coluna é
   * `citext`: "credito@" era gravado e o dossiê saía para o vazio.
   */
  test("e-mail torto é recusado antes de virar destino de envio", async ({ page }) => {
    await page.goto("/admin/developers");
    await aguardarCarregamento(page);

    const nome = `Construtora Email ${tag}`;
    await page.getByLabel("Nome", { exact: true }).fill(nome);
    await page.getByLabel("E-mail de envio", { exact: true }).fill("credito@");
    await page.getByRole("button", { name: /adicionar/i }).click();

    await expect(page.getByText(/e-mail inválido/i)).toBeVisible();
    expect(await construtoraPorNome(nome), "a construtora foi criada com e-mail torto").toHaveLength(0);
  });

  test("fluxo externo escolhido no cadastro exige e-mail e grava o fluxo", async ({ page }) => {
    await page.goto("/admin/developers");
    await aguardarCarregamento(page);

    const nome = `Construtora Externa ${tag}`;
    await page.getByLabel("Nome", { exact: true }).fill(nome);
    await page.getByLabel("Fluxo de crédito").click();
    await page.getByRole("option", { name: /fluxo externo/i }).click();
    await page.getByRole("button", { name: /adicionar/i }).click();
    await expect(page.getByText(/fluxo externo exige e-mail/i)).toBeVisible();

    // Com o e-mail, a construtora nasce já no fluxo externo — antes era
    // preciso cadastrar, salvar o e-mail e só então alternar o switch.
    await page.getByLabel("E-mail de envio", { exact: true }).fill(`credito+${tag}@construtora.test`);
    await page.getByRole("button", { name: /adicionar/i }).click();
    await expect(page.getByText(/construtora adicionada/i)).toBeVisible({ timeout: 15_000 });

    await expect(async () => {
      const [criada] = await construtoraPorNome(nome);
      expect(criada, "construtora não chegou em developers").toBeTruthy();
      expect(criada.flow).toBe("external");
      expect(criada.submission_email).toBe(`credito+${tag}@construtora.test`);
    }).toPass({ timeout: 10_000 });
  });

  /**
   * Contato, telefone, observações e empreendimento existiam no banco sem
   * caminho de escrita nenhum pela interface: `developer_projects` só entrava
   * por seed/SQL, mesmo sendo lida pelo cadastro de lead e pelo negócio.
   */
  test("edita a ficha da construtora e cadastra empreendimento", async ({ page }) => {
    const nome = `Construtora Ficha ${tag}`;
    const [construtora] = await db.insert<{ id: string; name: string }>("developers", {
      name: nome,
      slug: `construtora-ficha-${tag}`,
    });

    await page.goto("/admin/developers");
    await aguardarCarregamento(page);

    await page.getByRole("button", { name: `Editar ${nome}` }).click();
    const dialogo = page.getByRole("dialog");
    await dialogo.getByLabel("Contato").fill(`Fulano ${tag}`);
    await dialogo.getByLabel("Telefone").fill("11 90000-0000");
    await dialogo.getByLabel("Nome do empreendimento", { exact: true }).fill(`Residencial ${tag}`);
    await dialogo.getByLabel("Cidade do empreendimento").fill("Campinas");
    await dialogo.getByRole("button", { name: /^adicionar$/i }).click();
    await expect(page.getByText(/empreendimento adicionado/i)).toBeVisible({ timeout: 15_000 });

    await dialogo.getByRole("button", { name: /^salvar$/i }).click();
    await expect(page.getByText(/construtora salva/i)).toBeVisible({ timeout: 15_000 });

    await expect(async () => {
      const [ficha] = await construtoraPorNome(nome);
      expect(ficha.contact_name).toBe(`Fulano ${tag}`);
      const projetos = await db.select<{ name: string; city: string | null }>(
        `developer_projects?developer_id=eq.${construtora.id}&select=name,city`,
      );
      expect(projetos).toHaveLength(1);
      expect(projetos[0]).toMatchObject({ name: `Residencial ${tag}`, city: "Campinas" });
    }).toPass({ timeout: 10_000 });
  });
});

/**
 * Os dois switches da linha e a remoção — nenhum tinha teste.
 *
 * Os dois gravam direto, sem diálogo, e o `update` confere `select("id")`
 * porque o RLS recusa com 204: um switch que volta sozinho e um toast verde
 * eram indistinguíveis antes desta conferência.
 */
test.describe("Admin · construtoras: switches e remoção", () => {
  test("o switch de fluxo exige e-mail para sair do CCA interno, e volta sozinho", async ({ page }) => {
    const nome = `Construtora Switch ${tag}`;
    await db.insert("developers", { name: nome, slug: `construtora-switch-${tag}`, flow: "internal" });

    await page.goto("/admin/developers");
    await aguardarCarregamento(page);

    const fluxo = page.getByRole("switch", { name: `CCA interno de ${nome}` });
    await expect(fluxo).toBeChecked();

    // Sem e-mail cadastrado, a troca é barrada ANTES do banco: a constraint
    // `developers_external_requires_email` diria o mesmo, com erro genérico.
    await fluxo.click();
    await expect(page.getByText(/cadastre o e-mail de envio antes/i)).toBeVisible();
    await expect(fluxo, "o switch mudou de posição sem o banco ter mudado").toBeChecked();

    // Com o e-mail, a mesma troca passa e o banco confirma.
    await page.getByLabel(`E-mail de envio de ${nome}`).fill(`credito+switch${tag}@construtora.test`);
    await page.getByLabel(`E-mail de envio de ${nome}`).blur();
    await expect(page.getByText(/e-mail de envio salvo/i)).toBeVisible({ timeout: 15_000 });

    await page.getByRole("switch", { name: `CCA interno de ${nome}` }).click();
    await expect(page.getByText(/configuração atualizada/i)).toBeVisible({ timeout: 15_000 });
    await expect(async () => {
      const [dev] = await construtoraPorNome(nome);
      expect(dev.flow, "o fluxo não chegou em developers").toBe("external");
    }).toPass({ timeout: 10_000 });
  });

  test("desativar a construtora grava e avisa que o histórico fica", async ({ page }) => {
    const nome = `Construtora Ativa ${tag}`;
    await db.insert("developers", { name: nome, slug: `construtora-ativa-${tag}` });

    await page.goto("/admin/developers");
    await aguardarCarregamento(page);

    await page.getByRole("switch", { name: `Construtora ${nome} ativa` }).click();
    await expect(page.getByText(/construtora desativada/i)).toBeVisible({ timeout: 15_000 });
    // Desativar não pode passar por apagar: o texto promete que o histórico fica.
    await expect(page.getByText(/histórico de aportes e negócios continua/i)).toBeVisible();

    await expect(async () => {
      const [dev] = await db.select<{ active: boolean }>(
        `developers?name=eq.${encodeURIComponent(nome)}&select=active`,
      );
      expect(dev.active).toBe(false);
    }).toPass({ timeout: 10_000 });
  });

  test("remover construtora sem vínculo some da tela e do banco", async ({ page }) => {
    const nome = `Construtora Remover ${tag}`;
    await db.insert("developers", { name: nome, slug: `construtora-remover-${tag}` });

    await page.goto("/admin/developers");
    await aguardarCarregamento(page);
    const linha = page.getByRole("row").filter({ hasText: nome });
    await expect(linha).toBeVisible();

    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: `Remover ${nome}` }).click();
    await expect(page.getByText(/construtora removida/i)).toBeVisible({ timeout: 15_000 });
    await expect(linha).toHaveCount(0);

    await expect(async () => {
      expect(await construtoraPorNome(nome)).toHaveLength(0);
    }).toPass({ timeout: 10_000 });
  });
});

/**
 * Empreendimento: renomear, gravar UF e excluir.
 *
 * A tela só sabia criar e ativar/desativar. Um nome digitado errado ficava para
 * sempre na lista que o cadastro de lead e o negócio leem, e `state` era lida
 * em todo lugar e nunca preenchida — a coluna existia sempre nula.
 */
test.describe("Admin · empreendimentos", () => {
  test("cria com UF, renomeia no lugar e exclui", async ({ page }) => {
    const nomeDev = `Construtora Empreend ${tag}`;
    const [construtora] = await db.insert<{ id: string; name: string }>("developers", {
      name: nomeDev,
      slug: `construtora-empreend-${tag}`,
    });

    await page.goto("/admin/developers");
    await aguardarCarregamento(page);
    await page.getByRole("button", { name: `Editar ${nomeDev}` }).click();
    const dialogo = page.getByRole("dialog");

    await dialogo.getByLabel("Nome do empreendimento", { exact: true }).fill(`Torre A ${tag}`);
    await dialogo.getByLabel("Cidade do empreendimento").fill("Goiânia");
    await dialogo.getByLabel("UF do empreendimento").fill("go");
    await dialogo.getByRole("button", { name: /^adicionar$/i }).click();
    await expect(page.getByText(/empreendimento adicionado/i)).toBeVisible({ timeout: 15_000 });

    // A coluna é `character(2)` e a tela normaliza para caixa alta: mandar "go"
    // cru gravava minúsculo e a UF ficava fora do padrão das outras telas.
    await expect(async () => {
      const [projeto] = await db.select<{ name: string; state: string | null }>(
        `developer_projects?developer_id=eq.${construtora.id}&select=name,state`,
      );
      expect(projeto.state).toBe("GO");
    }).toPass({ timeout: 10_000 });

    // Renomear no lugar: grava no blur, como o e-mail da construtora.
    const campo = dialogo.getByLabel(`Nome do empreendimento Torre A ${tag}`);
    await campo.fill(`Torre B ${tag}`);
    await campo.blur();
    await expect(page.getByText(/empreendimento renomeado/i)).toBeVisible({ timeout: 15_000 });
    await expect(async () => {
      const [projeto] = await db.select<{ name: string }>(
        `developer_projects?developer_id=eq.${construtora.id}&select=name`,
      );
      expect(projeto.name).toBe(`Torre B ${tag}`);
    }).toPass({ timeout: 10_000 });

    // Excluir: sem vínculo, some da lista e do banco.
    page.once("dialog", (d) => void d.accept());
    await dialogo.getByRole("button", { name: `Excluir empreendimento Torre B ${tag}` }).click();
    await expect(page.getByText(/empreendimento excluído/i)).toBeVisible({ timeout: 15_000 });
    await expect(async () => {
      expect(
        await db.select(`developer_projects?developer_id=eq.${construtora.id}&select=id`),
      ).toHaveLength(0);
    }).toPass({ timeout: 10_000 });
  });

  // `character(2)`: "São Paulo" derrubaria o insert com 22001 e um erro cru.
  test("UF fora do formato é recusada com instrução, não com erro do banco", async ({ page }) => {
    const nomeDev = `Construtora UF ${tag}`;
    await db.insert("developers", { name: nomeDev, slug: `construtora-uf-${tag}` });

    await page.goto("/admin/developers");
    await aguardarCarregamento(page);
    await page.getByRole("button", { name: `Editar ${nomeDev}` }).click();
    const dialogo = page.getByRole("dialog");

    await dialogo.getByLabel("Nome do empreendimento", { exact: true }).fill(`Quadra ${tag}`);
    // O campo trunca em 2 caracteres; digitar um só deixa a UF incompleta.
    await dialogo.getByLabel("UF do empreendimento").fill("S");
    await dialogo.getByRole("button", { name: /^adicionar$/i }).click();

    await expect(page.getByText(/uf inválida/i)).toBeVisible();
  });
});

/**
 * O CCA abre a tela — e escreve nela.
 *
 * `developers_write` é `admin OU cca` desde sempre, e a 0063 concedeu
 * `menu.admin_developers` ao CCA de propósito: quem toca a esteira é quem sabe
 * se a construtora virou fluxo externo. Nenhum teste abria a tela com sessão de
 * CCA — a permissão existia dos dois lados e ninguém a exercia.
 */
test.describe("Admin · construtoras pelo CCA", () => {
  test("o analista de CCA abre /admin/developers e cadastra construtora", async ({ browser, baseURL }) => {
    const concessao = await db.select<{ allowed: boolean }>(
      "role_permissions?role=eq.cca&permission=eq.menu.admin_developers&select=allowed",
    );
    expect(
      concessao.some((r) => r.allowed),
      "o CCA perdeu `menu.admin_developers`: então é a matriz que mudou, não a tela",
    ).toBe(true);

    const { contexto, pagina } = await abrirComo(browser, baseURL, "cca");
    try {
      await pagina.goto("/admin/developers");
      await aguardarCarregamento(pagina);

      await expect(pagina.getByText(/acesso não liberado/i)).toHaveCount(0);
      await expect(pagina.getByRole("heading", { name: "Construtoras & CCA", level: 1 })).toBeVisible();

      const nome = `Construtora CCA ${tag}`;
      await pagina.getByLabel("Nome", { exact: true }).fill(nome);
      await pagina.getByRole("button", { name: /adicionar/i }).click();
      await expect(pagina.getByText(/construtora adicionada/i)).toBeVisible({ timeout: 15_000 });

      await expect(async () => {
        expect(await construtoraPorNome(nome), "o CCA não conseguiu gravar o que o RLS permite").toHaveLength(1);
      }).toPass({ timeout: 10_000 });
    } finally {
      await contexto.close();
    }
  });
});

/**
 * Links: o CRUD inteiro do administrador, que só tinha o smoke do título.
 */
test.describe("Admin · links", () => {
  const NOME = `Link admin ${tag}`;
  const URL_VALIDA = `https://exemplo.test/${tag}/admin`;

  test("cadastra, recusa URL relativa, recusa repetida, desativa e exclui", async ({ page }) => {
    await page.goto("/links");
    await aguardarCarregamento(page);

    // O formulário vive num diálogo, e o cabeçalho da tela tem o filtro
    // "Filtrar por categoria" — outro rótulo, mas `getByLabel` casa por pedaço e
    // "Categoria" cabe dentro dele. Recortar pelo diálogo é o que a tela já faz
    // de verdade (o resto fica `aria-hidden` enquanto o modal está aberto).
    const dialogo = page.getByRole("dialog");

    // 1. URL sem protocolo: gravar "banana" fazia o card navegar para /banana
    //    dentro do próprio app — link quebrado com cara de tela quebrada.
    await page.getByRole("button", { name: /novo link/i }).click();
    await dialogo.getByLabel("Nome").fill(NOME);
    await dialogo.getByLabel("URL").fill("banana");
    await dialogo.getByLabel("Categoria").fill(`categoria ${tag}`);
    await page.getByRole("button", { name: /^salvar$/i }).click();
    await expect(page.getByText(/url inválida/i)).toBeVisible();

    // 2. Com URL absoluta, grava.
    await dialogo.getByLabel("URL").fill(URL_VALIDA);
    await page.getByRole("button", { name: /^salvar$/i }).click();
    await expect(page.getByText("Salvo!", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(async () => {
      const [linha] = await db.select<{ url: string; active: boolean }>(
        `useful_links?label=eq.${encodeURIComponent(NOME)}&select=url,active`,
      );
      expect(linha, "o link não chegou em useful_links").toBeTruthy();
      expect(linha.url).toBe(URL_VALIDA);
    }).toPass({ timeout: 10_000 });

    // 3. A MESMA URL em outro nome é recusada nomeando quem já a usa — sem
    //    isso a lista ganhava dois cartões idênticos com nomes diferentes.
    await page.getByRole("button", { name: /novo link/i }).click();
    await dialogo.getByLabel("Nome").fill(`Outro ${tag}`);
    await dialogo.getByLabel("URL").fill(`${URL_VALIDA}/`);
    await page.getByRole("button", { name: /^salvar$/i }).click();
    await expect(page.getByText(/já está cadastrado/i)).toBeVisible();
    await expect(page.getByText(NOME, { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: /cancelar/i }).click();

    // 4. Desativar: o admin continua vendo, com a tarja — desativar não é apagar.
    await page.getByRole("switch", { name: `Link ${NOME} ativo` }).click();
    await expect(page.getByText(/link desativado/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("inativo", { exact: true }).first()).toBeVisible();
    await expect(async () => {
      const [linha] = await db.select<{ active: boolean }>(
        `useful_links?label=eq.${encodeURIComponent(NOME)}&select=active`,
      );
      expect(linha.active).toBe(false);
    }).toPass({ timeout: 10_000 });

    // 5. Editar preserva o estado: gravar `active: true` fixo reativava sem
    //    querer o link que o admin acabara de desativar.
    await page.getByRole("button", { name: `Editar ${NOME}` }).click();
    await dialogo.getByLabel("Nome").fill(`${NOME} corrigido`);
    await page.getByRole("button", { name: /^salvar$/i }).click();
    await expect(page.getByText("Salvo!", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(async () => {
      const [linha] = await db.select<{ label: string; active: boolean }>(
        `useful_links?url=eq.${encodeURIComponent(URL_VALIDA)}&select=label,active`,
      );
      expect(linha.label).toBe(`${NOME} corrigido`);
      expect(linha.active, "editar reativou o link que estava desativado").toBe(false);
    }).toPass({ timeout: 10_000 });

    // 6. Excluir.
    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: `Excluir ${NOME} corrigido` }).click();
    await expect(page.getByText(/link excluído/i)).toBeVisible({ timeout: 15_000 });
    await expect(async () => {
      expect(
        await db.select(`useful_links?url=eq.${encodeURIComponent(URL_VALIDA)}&select=id`),
      ).toHaveLength(0);
    }).toPass({ timeout: 10_000 });
  });
});

test.describe("Admin · construtoras no celular", () => {
  test.use({ viewport: { width: 375, height: 780 } });

  // A tabela tem 5 colunas com dois switches e dois botões por linha: é o
  // desenho mais apertado do bloco e nunca foi medido em 375 px.
  test("a tabela de construtoras não empurra a página para a direita", async ({ page }) => {
    await page.goto("/admin/developers");
    await aguardarCarregamento(page);
    await expect(page.getByRole("heading", { name: "Construtoras & CCA", level: 1 })).toBeVisible();

    const transbordo = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(transbordo, "a página rola na horizontal em 375 px").toBeLessThanOrEqual(1);
  });
});

test.describe("Admin · dados no celular", () => {
  test.use({ viewport: { width: 375, height: 780 } });

  test("/data cabe em 375 px nas duas abas", async ({ page }) => {
    await page.goto("/data");
    await aguardarCarregamento(page);
    await expect(page.getByRole("heading", { name: /gestão de dados/i, level: 1 })).toBeVisible();

    const sobra = () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await sobra(), "a aba Leadfy rola na horizontal em 375 px").toBeLessThanOrEqual(1);

    await page.getByRole("tab", { name: "Marketing" }).click();
    await expect(page.getByRole("button", { name: /salvar aporte/i })).toBeVisible();
    expect(await sobra(), "a aba Marketing rola na horizontal em 375 px").toBeLessThanOrEqual(1);
  });
});

/**
 * Ordem dos links — o campo era um número digitado e nada mais.
 *
 * O estado normal do banco é todo mundo em `sort_order = 0`: quem quisesse pôr
 * um link no topo tinha de abrir a ficha de cada um e inventar uma numeração à
 * mão. As setas renumeram o grupo por posição, o que resolve o empate; e o
 * `update` confere `select("id")` porque `useful_links_write` é `is_admin()` e
 * o RLS recusa com 204 — sem isso a lista se reordenava na tela e voltava no
 * próximo F5.
 */
test.describe("Admin · ordem dos links", () => {
  const CATEGORIA = `ordem ${tag}`;
  const A = `Link ordem A ${tag}`;
  const B = `Link ordem B ${tag}`;
  const C = `Link ordem C ${tag}`;

  test("as setas reordenam dentro da categoria e o banco guarda a posição", async ({ page }) => {
    // Todos em zero de propósito: é o empate que a renumeração precisa desfazer.
    await db.insert("useful_links", [A, B, C].map((label, i) => ({
      label,
      url: `https://exemplo.test/${tag}/ordem-${i}`,
      category: CATEGORIA,
      sort_order: 0,
      active: true,
    })));

    await page.goto("/links");
    await aguardarCarregamento(page);

    const secao = page.locator("section").filter({
      has: page.getByRole("heading", { name: new RegExp(CATEGORIA, "i"), level: 2 }),
    });
    const ordemNaTela = () =>
      secao.getByRole("link").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));

    // Empatados em zero, a lista sai pelo nome — é a ordem do `select`.
    expect(await ordemNaTela()).toEqual([`Abrir ${A}`, `Abrir ${B}`, `Abrir ${C}`]);

    // Nas pontas o botão que não teria efeito aparece desabilitado, em vez de
    // clicar e não fazer nada.
    await expect(page.getByRole("button", { name: `Subir ${A}` })).toBeDisabled();
    await expect(page.getByRole("button", { name: `Descer ${C}` })).toBeDisabled();

    await page.getByRole("button", { name: `Descer ${A}` }).click();
    await expect(async () => {
      expect(await ordemNaTela()).toEqual([`Abrir ${B}`, `Abrir ${A}`, `Abrir ${C}`]);
    }).toPass({ timeout: 10_000 });

    // E a posição é do banco, não só da tela: recarregar mantém.
    await expect(async () => {
      const linhas = await db.select<{ label: string; sort_order: number }>(
        `useful_links?category=eq.${encodeURIComponent(CATEGORIA)}&select=label,sort_order&order=sort_order`,
      );
      expect(linhas.map((l) => l.label)).toEqual([B, A, C]);
      expect(linhas.map((l) => l.sort_order)).toEqual([0, 1, 2]);
    }).toPass({ timeout: 10_000 });

    await page.reload();
    await aguardarCarregamento(page);
    expect(await ordemNaTela()).toEqual([`Abrir ${B}`, `Abrir ${A}`, `Abrir ${C}`]);

    // Subir também: o último passa para o meio.
    await page.getByRole("button", { name: `Subir ${C}` }).click();
    await expect(async () => {
      expect(await ordemNaTela()).toEqual([`Abrir ${B}`, `Abrir ${C}`, `Abrir ${A}`]);
    }).toPass({ timeout: 10_000 });

    // Retorno PERCEBÍVEL: a lista se reordenava em silêncio e só o fracasso
    // falava (toast de erro). Para quem usa leitor de tela, acionar a seta e não
    // receber nada desfaz a razão de ter preferido botão a arrastar.
    await expect(page.locator("p.sr-only[aria-live='polite']")).toContainText(
      `${C} movido para a posição 2 de 3`,
    );

    // Fora da ponta a seta acionada continua válida e mantém o foco.
    await expect(page.locator(":focus")).toHaveAttribute("aria-label", `Subir ${C}`);

    // Na ponta ela vira `disabled` e o navegador jogaria o foco no <body>: quem
    // navega por teclado teria de varrer a página inteira com Tab de novo.
    await page.getByRole("button", { name: `Subir ${C}` }).click();
    await expect(async () => {
      expect(await ordemNaTela()).toEqual([`Abrir ${C}`, `Abrir ${B}`, `Abrir ${A}`]);
    }).toPass({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: `Subir ${C}` })).toBeDisabled();
    await expect(
      page.locator(":focus"),
      "a seta desabilitada levou o foco para o <body>",
    ).toHaveAttribute("aria-label", `Descer ${C}`);
  });
});

/**
 * /data na visão de quem só lê o aporte.
 *
 * `marketing_investments_write` é `admin OU marketing`, e `menu.data` é
 * concedido também a diretor, gerente e sócio. Os dois lados nunca foram
 * exercitados juntos: se o formulário voltasse a aparecer para eles, todo
 * Salvar responderia 204 — recusa do RLS que não erra — e a tela diria
 * "Aporte salvo" sem ter salvo nada.
 *
 * O diretor É quem importa lead (`leads_insert` aceita director, manager,
 * marketing e sdr), então a caixa do Leadfy continua para ele: os dois recortes
 * são independentes e a tela precisa distinguir um do outro.
 */
test.describe("Admin · dados na visão de quem só lê", () => {
  test("o diretor lê os aportes do mês, não vê o formulário e ainda importa lead", async ({ browser, baseURL }) => {
    const concessao = await db.select<{ allowed: boolean }>(
      "role_permissions?role=eq.director&permission=eq.menu.data&select=allowed",
    );
    expect(
      concessao.some((r) => r.allowed),
      "o diretor perdeu `menu.data`: então é a matriz que mudou, não a tela",
    ).toBe(true);

    const { contexto, pagina } = await abrirComo(browser, baseURL, "director");
    try {
      await pagina.goto("/data");
      await aguardarCarregamento(pagina);
      await expect(pagina.getByText(/acesso não liberado/i)).toHaveCount(0);

      // Leadfy: ele importa lead, então o botão é dele.
      await expect(pagina.getByRole("button", { name: /importar planilha/i })).toBeVisible();

      await pagina.getByRole("tab", { name: "Marketing" }).click();
      // Lê o total do mês…
      await expect(pagina.getByText(/total do mês/i)).toBeVisible();
      // …e não vê nada que o banco recusaria.
      await expect(pagina.getByLabel("Valor do aporte")).toHaveCount(0);
      await expect(pagina.getByRole("button", { name: /salvar aporte/i })).toHaveCount(0);
      await expect(pagina.getByText(/importar planilha de aportes/i)).toHaveCount(0);
      // E a tela diz de quem é o lançamento, em vez de deixar o espaço mudo.
      await expect(pagina.getByText(/são do marketing e do administrador/i)).toBeVisible();
    } finally {
      await contexto.close();
    }
  });
});

test.describe("Admin · links no celular", () => {
  test.use({ viewport: { width: 375, height: 780 } });

  // A linha do ADMIN é a mais larga da tela — copiar, abrir, subir, descer,
  // switch, editar e excluir — e o teste de 375 px de `e2e/marketing/links`
  // roda com o papel `marketing`, que não vê nenhum desses botões.
  test("a linha com todos os controles do admin não empurra a página", async ({ page }) => {
    const nome = `Link celular ${tag}`;
    await db.insert("useful_links", {
      label: nome,
      url: `https://exemplo.test/${tag}/celular`,
      category: `celular ${tag}`,
      sort_order: 0,
      active: true,
    });

    await page.goto("/links");
    await aguardarCarregamento(page);
    await expect(page.getByRole("button", { name: `Excluir ${nome}` })).toBeVisible();

    const transbordo = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(transbordo, "a página rola na horizontal em 375 px").toBeLessThanOrEqual(1);
  });
});
