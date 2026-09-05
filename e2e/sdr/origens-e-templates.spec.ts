/**
 * Módulo SDR IA — abas "Origens" e "WhatsApp", na visão do papel `sdr`.
 *
 * A ata de 14/07 amarra origem do lead → agente que atende → template de
 * boas-vindas ("o sistema dispara um template de WhatsApp para o lead
 * recém-chegado"). No banco isso são as colunas `lead_sources.sdr_agent_id` e
 * `lead_sources.welcome_template_id` (migration 0008).
 *
 * O SDR cadastra a origem, vincula agente/template e — desde a migration 0069
 * — edita o próprio template que dispara: `whatsapp_templates_write` passou a
 * aceitar admin, marketing e sdr, porque antes o único editor efetivo era o
 * admin (marketing sequer tinha `menu.sdr` para abrir a tela).
 *
 * Ampliar quem escreve só vale com a recusa coberta do outro lado: o último
 * bloco roda como `director` — papel que TEM `menu.sdr` e fica de fora de
 * `whatsapp_templates_write` — e cobra as duas barreiras separadamente: a tela
 * sem formulário de escrita e o UPDATE que casa zero linhas no banco.
 */
import { test, expect, db, aguardarCarregamento, runTag } from "../support/fixtures";
import { mintSession, storageStateFor } from "../support/session";
import { resolveTarget } from "../support/target";
import { userFor } from "../support/users";

const alvo = resolveTarget();
const tag = runTag();
/** Sufixo válido para `whatsapp_templates.name` (a Meta só aceita [a-z0-9_]). */
const slug = tag.replace(/[^a-z0-9]/gi, "_").toLowerCase();

type OrigemRow = {
  id: string;
  code: string;
  label: string;
  channel: string;
  active: boolean;
  sdr_agent_id: string | null;
  welcome_template_id: string | null;
};

const origensComRotulo = (rotulo: string) =>
  db.select<OrigemRow>(
    `lead_sources?label=eq.${encodeURIComponent(rotulo)}&select=id,code,label,channel,active,sdr_agent_id,welcome_template_id`,
  );

test.afterAll(async () => {
  await db.remove(`lead_sources?label=like.*${tag}*`);
});

test.describe("SDR · origens de lead", () => {
  test("mostra as origens do banco com o agente já vinculado", async ({ page }) => {
    const doBanco = await db.select<OrigemRow>(
      "lead_sources?select=id,code,label,channel,active,sdr_agent_id,welcome_template_id&order=created_at",
    );
    const comAgente = doBanco.find((o) => o.sdr_agent_id);
    expect(comAgente, "seed sem origem vinculada a agente — cenário incompleto").toBeTruthy();

    await page.goto("/sdr");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: /origens/i }).click();

    const painel = page.getByRole("tabpanel");
    // A asserção é sobre a LISTA, não sobre o painel inteiro. O formulário de
    // cadastro divide o mesmo painel e o select "Canal" exibe o rótulo do canal
    // escolhido — "Meta Ads" por padrão (`VAZIO.channel = "meta"`) —, texto
    // idêntico ao rótulo de uma das origens do seed. Buscando no painel,
    // `getByText("Meta Ads", exact)` casa o <span> do combobox E o <b> da
    // linha, e o strict mode barra antes de conferir coisa alguma.
    const linhas = painel.locator("div.border.rounded");
    for (const origem of doBanco) {
      await expect(linhas.getByText(origem.label, { exact: true })).toBeVisible();
    }

    // Não é lista decorativa: o agente exibido é o que está gravado na coluna.
    const [agente] = await db.select<{ name: string }>(
      `sdr_agents?id=eq.${comAgente!.sdr_agent_id}&select=name`,
    );
    await expect(linhas.filter({ hasText: comAgente!.label })).toContainText(agente.name);
  });

  test("SDR cadastra uma origem simples", async ({ page }) => {
    const rotulo = `Origem ${tag}`;

    await page.goto("/sdr");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: /origens/i }).click();

    const painel = page.getByRole("tabpanel");
    await painel.getByPlaceholder("Rótulo").fill(rotulo);
    await painel.getByPlaceholder(/form_id/).fill(`form-${tag}`);
    await painel.getByRole("button", { name: /adicionar/i }).click();

    await expect(async () => {
      expect(await origensComRotulo(rotulo)).toHaveLength(1);
    }).toPass({ timeout: 10_000 });
    await expect(painel.getByText(rotulo, { exact: true })).toBeVisible();
  });

  // Regressão da 0031: o vínculo completo precisa sobreviver à gravação real.
  test("vincula agente e template de boas-vindas a uma origem", async ({ page }) => {
    const rotulo = `Origem ${tag} vinculada`;
    const [agente] = await db.select<{ id: string; name: string }>(
      "sdr_agents?select=id,name&limit=1",
    );
    const [template] = await db.select<{ id: string; name: string }>(
      "whatsapp_templates?select=id,name&limit=1",
    );

    await page.goto("/sdr");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: /origens/i }).click();

    const painel = page.getByRole("tabpanel");
    await painel.getByPlaceholder("Rótulo").fill(rotulo);
    await painel.getByRole("combobox").filter({ hasText: /agente/i }).click();
    await page.getByRole("option", { name: agente.name }).click();
    await painel.getByRole("combobox").filter({ hasText: /template/i }).click();
    await page.getByRole("option", { name: template.name }).click();
    await painel.getByRole("button", { name: /adicionar/i }).click();

    await expect(async () => {
      const [gravada] = await origensComRotulo(rotulo);
      expect(gravada.sdr_agent_id).toBe(agente.id);
      expect(gravada.welcome_template_id).toBe(template.id);
    }).toPass({ timeout: 10_000 });
  });

  /**
   * `channel` tem CHECK no banco, alimenta relatório por canal e a tela nunca
   * o preenchia — ficava nulo em toda origem criada pelo app. E desligar uma
   * origem do fluxo de IA só era possível excluindo, o que zerava o vínculo
   * dos leads já gravados.
   */
  test("grava o canal e permite desativar sem excluir", async ({ page }) => {
    const rotulo = `Origem ${tag} canal`;

    await page.goto("/sdr");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: /origens/i }).click();

    const painel = page.getByRole("tabpanel");
    await painel.getByPlaceholder("Rótulo").fill(rotulo);
    await painel.getByLabel("Canal").click();
    await page.getByRole("option", { name: "Portal" }).click();
    await painel.getByRole("switch", { name: /ativa/i }).click();
    await painel.getByRole("button", { name: /adicionar/i }).click();

    await expect(async () => {
      const [gravada] = await origensComRotulo(rotulo);
      expect(gravada, "origem não chegou em lead_sources").toBeTruthy();
      expect(gravada.channel).toBe("portal");
      expect(gravada.active, "o switch Ativa precisa chegar ao banco").toBe(false);
    }).toPass({ timeout: 10_000 });

    await expect(
      painel.locator("div.border.rounded").filter({ hasText: rotulo }),
    ).toContainText("inativa");
  });

  // Era defeito: a linha da origem não abria nada — para trocar o agente da
  // origem que roteia leads para o SDR, só apagando e recadastrando, o que
  // zerava `leads.source_id`. Agora a linha entra em edição e o UPDATE persiste.
  test("edita uma origem existente sem recadastrar", async ({ page }) => {
    const rotulo = `Origem ${tag} editável`;
    const [criada] = await db.insert<OrigemRow>("lead_sources", {
      code: `origem_${tag.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_edit`,
      label: rotulo,
    });
    const [agente] = await db.select<{ id: string; name: string }>("sdr_agents?select=id,name&limit=1");

    await page.goto("/sdr");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: /origens/i }).click();

    const painel = page.getByRole("tabpanel");
    await painel.getByText(rotulo, { exact: true }).click();
    await expect(painel.getByPlaceholder("Rótulo")).toHaveValue(rotulo);
    await painel.getByRole("combobox").filter({ hasText: /agente/i }).click();
    await page.getByRole("option", { name: agente.name }).click();
    await painel.getByRole("button", { name: /^salvar$/i }).click();
    await expect(page.getByText(/origem atualizada/i)).toBeVisible();

    await expect(async () => {
      const [depois] = await db.select<OrigemRow>(
        `lead_sources?id=eq.${criada.id}&select=id,code,label,channel,active,sdr_agent_id,welcome_template_id`,
      );
      expect(depois.sdr_agent_id).toBe(agente.id);
      // Editar não troca a chave: o `code` que o webhook casa com utm_source fica.
      expect(depois.code).toBe(criada.code);
    }).toPass({ timeout: 10_000 });
  });
});

test.describe("SDR · template de WhatsApp", () => {
  type TemplateRow = { id: string; name: string; body: string };
  const extra = `tpl_${slug}`;
  const torto = `tpl_torto_${slug}`;

  /**
   * Todo template do cenário nasce aqui e sai no `afterAll`, POR PREFIXO.
   *
   * Criar dentro do teste e apagar na última linha do corpo só limpa quando o
   * teste passa — que é justamente o caso em que não há lixo a explicar. Um
   * `expect` que estoura antes deixaria a linha na homologação para sempre, e
   * template não fica invisível: aparece na lista da aba WhatsApp, no select
   * "Template de boas-vindas" da aba Origens e na aba Remarketing.
   */
  test.beforeAll(async () => {
    // As DUAS linhas repetem as MESMAS chaves, `variables` inclusive. Num
    // insert em lote o PostgREST monta um `INSERT` só e recusa com PGRST102
    // ("All object keys must match") quando um objeto traz uma chave que o
    // outro não tem — era o 400 que derrubava este `beforeAll` inteiro, e com
    // ele os quatro testes do arquivo. `variables` é NOT NULL default '{}', por
    // isso o vazio explícito é `[]` e não `null`.
    await db.insert("whatsapp_templates", [
      // Um segundo template garante que a lista não para no primeiro. Declara
      // a variável do {{1}} porque o cenário dele é EDITAR e salvar: um corpo
      // com um placeholder e nenhuma variável é template quebrado, e o Salvar
      // passou a barrar isso (a Meta recusaria o envio de qualquer forma).
      { name: extra, body: "Olá, {{1}}!", language: "pt_BR", variables: ["nome"] },
      // Corpo com {{1}} e {{2}} declarando uma variável só: o aviso da tela tem
      // de sair aqui, e não na recusa da Graph API em tempo de envio.
      {
        name: torto,
        body: "Olá {{1}}, tudo bem? Vi seu interesse em {{2}}.",
        language: "pt_BR",
        variables: ["nome"],
      },
    ]);
  });
  test.afterAll(async () => {
    await db.remove(`whatsapp_templates?name=like.*${slug}*`);
  });

  // Era defeito: a aba só alcançava `templates[0]` — sem lista nem "Novo",
  // digitar outro nome renomeava o template existente (e o nome vai para a
  // Meta no disparo). Agora todos aparecem numa lista e a seleção troca o
  // formulário.
  test("lista todos os templates e abre o escolhido", async ({ page }) => {
    const doBanco = await db.select<TemplateRow>("whatsapp_templates?select=id,name,body&order=created_at");
    expect(doBanco.length, "cenário precisa de ao menos dois templates").toBeGreaterThan(1);

    await page.goto("/sdr");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: /whatsapp/i }).click();

    const painel = page.getByRole("tabpanel");
    // O nome sozinho não identifica um botão: a lista divide o painel com o
    // formulário do template selecionado, cujo "Excluir template X" repete o
    // nome no aria-label — e `getByRole(name:)` casa por SUBSTRING. Como a aba
    // abre com `templates[0]` já selecionado, o nome dele alcança os dois. O
    // item da lista é o botão que contém o nome como texto.
    const item = (nome: string) =>
      painel.getByRole("button").filter({ has: page.getByText(nome, { exact: true }) });
    for (const t of doBanco) {
      await expect(item(t.name)).toBeVisible();
    }
    await item(extra).click();
    await expect(painel.getByLabel(/nome do template/i)).toHaveValue(extra);
  });

  /**
   * Até a 0069 esta aba ficava travada para o `sdr`:
   * `whatsapp_templates_write` aceitava só admin e marketing, e `marketing` não
   * tinha `menu.sdr` para abrir a tela — na prática o único editor era o admin,
   * enquanto o papel que administra agentes, origens e listas via bloqueado
   * justamente o template que ele dispara. A 0069 alinhou os dois lados; este
   * caso cobra os DOIS juntos: campo liberado na tela E update aceito pela RLS
   * (que, barrando, casaria 0 linhas sem erro nenhum).
   */
  test("papel sdr edita o template e o banco confirma", async ({ page }) => {
    await page.goto("/sdr");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: /whatsapp/i }).click();

    const painel = page.getByRole("tabpanel");
    // Mesma armadilha do caso acima: o nome também aparece no "Excluir template X".
    await painel.getByRole("button").filter({ has: page.getByText(extra, { exact: true }) }).click();
    await expect(painel.getByLabel(/nome do template/i)).toBeEnabled();

    const corpo = `Olá, {{1}}! Editado pelo sdr ${tag}`;
    await painel.getByLabel(/^mensagem$/i).fill(corpo);
    await painel.getByRole("button", { name: /^salvar$/i }).click();
    await expect(page.getByText(/template atualizado/i)).toBeVisible();
    await expect(page.getByText(/verifique sua permissão/i), "toast de recusa da RLS").toHaveCount(0);

    await expect(async () => {
      const [gravado] = await db.select<TemplateRow>(
        `whatsapp_templates?name=eq.${extra}&select=id,name,body`,
      );
      expect(gravado.body, "tela disse que salvou; o banco tem de concordar").toBe(corpo);
    }).toPass({ timeout: 10_000 });
  });

  /**
   * O defeito que mais custava caro: o corpo declarava {{1}} e {{2}}, a lista
   * `variables` tinha um nome só, e o envio só falhava na Graph API — a falha
   * aparecia em `remarketing_contacts.last_error`, longe de quem cadastrou.
   * Agora a aba diz na hora, e mostra a mensagem já preenchida.
   */
  test("template com variáveis a menos avisa antes de qualquer disparo", async ({ page }) => {
    await page.goto("/sdr");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: /whatsapp/i }).click();

    const painel = page.getByRole("tabpanel");
    await painel.getByRole("button").filter({ has: page.getByText(torto, { exact: true }) }).click();
    await expect(painel.getByText(/a meta recusa o envio/i)).toBeVisible();
    // Pré-visualização com o que o envio real colocaria em cada posição.
    await expect(painel.getByText(/Olá Maria Souza, tudo bem\?/)).toBeVisible();
  });

  /**
   * Excluir template era um `confirm()` do navegador com um texto genérico
   * ("as origens e listas que o usam"): sem o número, quem lia não tinha como
   * saber se a exclusão derrubava uma origem ou vinte. E `confirm()` não é
   * alcançável por teste de tela, então o caminho ficava sem cobertura
   * justamente onde a FK é ON DELETE SET NULL — a exclusão NÃO falha, ela
   * desliga as boas-vindas em silêncio.
   */
  test("excluir template diz quantas origens perdem as boas-vindas, e cancelar não exclui", async ({ page }) => {
    const nome = `tpl_vinculado_${slug}`;
    const [tpl] = await db.insert<{ id: string }>("whatsapp_templates", {
      name: nome, body: "Olá, {{1}}!", language: "pt_BR", variables: ["nome"],
    });
    const codigo = `e2e_tpl_${slug}`;
    await db.insert("lead_sources", {
      code: codigo,
      label: `Origem com template ${tag}`,
      channel: "meta",
      welcome_template_id: tpl.id,
      active: true,
    });

    await page.goto("/sdr");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: /whatsapp/i }).click();

    const painel = page.getByRole("tabpanel");
    await painel.getByRole("button").filter({ has: page.getByText(nome, { exact: true }) }).click();
    await painel.getByRole("button", { name: `Excluir template ${nome}` }).click();

    const dialogo = page.getByRole("alertdialog");
    await expect(dialogo).toContainText(nome);
    await expect(dialogo, "o número é o que decide se dá para excluir").toContainText("1 origem de lead");

    await dialogo.getByRole("button", { name: /cancelar/i }).click();
    await expect(dialogo).toHaveCount(0);
    expect(
      await db.select<TemplateRow>(`whatsapp_templates?id=eq.${tpl.id}&select=id,name,body`),
      "cancelar excluiu o template mesmo assim",
    ).toHaveLength(1);

    // Agora vai: confirmar exclui, e a origem fica sem template — que é
    // exatamente o efeito que o diálogo prometeu.
    await painel.getByRole("button", { name: `Excluir template ${nome}` }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: /excluir template/i }).click();
    await expect(page.getByText(/template excluído/i)).toBeVisible();

    await expect(async () => {
      expect(
        await db.select<TemplateRow>(`whatsapp_templates?id=eq.${tpl.id}&select=id,name,body`),
      ).toHaveLength(0);
    }).toPass({ timeout: 10_000 });
    const [origem] = await db.select<OrigemRow>(
      `lead_sources?code=eq.${codigo}&select=id,code,label,channel,active,sdr_agent_id,welcome_template_id`,
    );
    expect(origem.welcome_template_id, "a FK é SET NULL: a origem sobrevive sem template").toBeNull();
  });


/**
 * O nome do template é o que a Meta usa para casar o disparo, e a coluna é
 * única. `save()` caía no genérico do `describeError` ("Já existe um registro
 * com esses dados"), que não diz qual campo repetiu — enquanto o AgentsTab e o
 * SourcesTab já nomeavam a coluna duplicada.
 *
 * O 409 do PostgREST é provocado de propósito; o navegador registra o recurso.
 */
test.describe(() => {
  test.use({ errosEsperados: [/status of 409/i] });

  test("nome de template repetido diz qual campo repetiu", async ({ page }) => {
    await page.goto("/sdr");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: /whatsapp/i }).click();

    const painel = page.getByRole("tabpanel");
    await painel.getByRole("button", { name: /^novo$/i }).click();
    await painel.getByLabel(/nome do template/i).fill(extra);
    await painel.getByLabel(/^mensagem$/i).fill("Corpo qualquer para o duplicado");
    await painel.getByRole("button", { name: /^salvar$/i }).click();

    await expect(page.getByText(/já existe um template chamado/i)).toBeVisible();
    // O genérico não pode aparecer: é ele que deixava o operador sem saber o
    // que corrigir.
    await expect(page.getByText(/já existe um registro com esses dados/i)).toHaveCount(0);

    // E nada de segundo template com o mesmo nome no banco.
    const iguais = await db.select<TemplateRow>(
      `whatsapp_templates?name=eq.${extra}&select=id,name,body`,
    );
    expect(iguais, "o unique(name) tem de continuar valendo").toHaveLength(1);
  });
});

  /**
   * A outra metade da 0069: ampliar quem escreve não pode apagar a recusa.
   *
   * `director` tem `menu.sdr` (0015) e fica de fora de
   * `whatsapp_templates_write` — é o recorte que prova as DUAS barreiras sem
   * uma depender da outra. Sem este bloco, afrouxar a policy de novo não
   * reprovaria nada: o caso feliz continuaria verde do mesmo jeito.
   */
  test.describe("papel com menu.sdr que não escreve template", () => {
    const diretor = userFor("director");

    test("a aba WhatsApp não oferece escrita a quem não escreve", async ({ browser, baseURL }) => {
      // A sessão é gravada no localStorage da ORIGEM do app: sem ela não há
      // onde escrever, e o teste abriria o /sdr deslogado passando por engano.
      if (!baseURL) throw new Error("baseURL do Playwright ausente");
      const sessao = await mintSession(diretor.email);
      const contexto = await browser.newContext({
        baseURL,
        storageState: storageStateFor(sessao, baseURL),
      });
      const pagina = await contexto.newPage();
      try {
        await pagina.goto("/sdr");
        await aguardarCarregamento(pagina);
        // O papel ENTRA no módulo: o que ele não pode é gravar template.
        await expect(pagina.getByText(/acesso não liberado/i)).toHaveCount(0);
        await pagina.getByRole("tab", { name: /whatsapp/i }).click();

        const painel = pagina.getByRole("tabpanel");
        await expect(painel.getByLabel(/nome do template/i)).toBeDisabled();
        // Esconder o controle sem dizer o motivo é tela quebrada.
        await expect(painel.getByText(/só consulta/i)).toBeVisible();
        await expect(painel.getByRole("button", { name: /^salvar$/i })).toHaveCount(0);
        await expect(painel.getByRole("button", { name: /^novo$/i })).toHaveCount(0);
        await expect(painel.getByRole("button", { name: /excluir template/i })).toHaveCount(0);
      } finally {
        await contexto.close();
      }
    });

    /**
     * Esconder o botão é metade; a outra é o banco recusar. E a recusa do
     * `using` NÃO é erro: volta 200 com lista vazia. É exatamente a resposta
     * que `WhatsAppTab.save()` trata como `SEM_PERMISSAO` em vez de "salvo" —
     * o guard que só um caso como este alcança.
     */
    test("UPDATE de template com o JWT desse papel casa zero linhas, sem erro", async () => {
      const [antes] = await db.select<TemplateRow>(
        `whatsapp_templates?name=eq.${torto}&select=id,name,body`,
      );
      expect(antes, "fixture do template sumiu — o cenário seria vazio").toBeTruthy();
      const { access_token } = await mintSession(diretor.email);

      const res = await fetch(`${alvo.supabaseUrl}/rest/v1/whatsapp_templates?id=eq.${antes.id}`, {
        method: "PATCH",
        headers: {
          apikey: alvo.anonKey,
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({ body: `tentativa do diretor ${tag}` }),
      });

      expect(res.status, "a RLS não devolve erro; devolve nenhuma linha").toBe(200);
      expect(
        await res.json(),
        "papel fora de whatsapp_templates_write gravou template",
      ).toHaveLength(0);

      const [depois] = await db.select<TemplateRow>(
        `whatsapp_templates?id=eq.${antes.id}&select=id,name,body`,
      );
      expect(depois.body, "o corpo do template não podia ter mudado").toBe(antes.body);
    });
  });
});
