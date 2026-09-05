/**
 * Módulo SDR IA — CRUD de agentes e playground, na visão do papel `sdr`.
 *
 * A ata de 14/07 pede "um grupo especial para SDR atendido por IA" que qualifica
 * o lead antes de devolvê-lo à roleta. O agente é a peça configurável desse
 * fluxo: se a tela diz "Agente salvo" e `sdr_agents` não muda, a configuração da
 * IA é decorativa. Por isso toda asserção de gravação termina no banco.
 */
import { test, expect, db, aguardarCarregamento, runTag } from "../support/fixtures";
import { mintSession, storageStateFor } from "../support/session";
import { resolveTarget } from "../support/target";
import { userFor } from "../support/users";

const tag = runTag();
const alvoE2E = resolveTarget();

type AgenteRow = {
  id: string;
  name: string;
  role: string;
  model: string;
  temperature: number;
  max_turns: number;
  handoff_group_id: string | null;
  system_prompt: string | null;
  active: boolean;
};

const porNome = (nome: string) =>
  db.select<AgenteRow>(
    `sdr_agents?name=eq.${encodeURIComponent(nome)}&select=id,name,role,model,temperature,max_turns,handoff_group_id,system_prompt,active`,
  );

/** A linha da lista é um `li` com DOIS botões irmãos: abrir (com o nome como
 *  texto) e excluir (só ícone, nomeado por `aria-label`). Era um `div` com
 *  `role="button"` e o de excluir aninhado dentro — a ARIA 1.2 manda o leitor
 *  de tela descartar os descendentes de um `button`, o que apagava o único
 *  caminho de exclusão. Por isso a linha é o `listitem`, não o botão. */
const linhaDoAgente = (page: import("@playwright/test").Page, nome: string) =>
  page.getByRole("tabpanel").getByRole("listitem").filter({ hasText: nome });

/** O botão que abre o agente para edição, dentro da linha. */
const abrirAgente = (page: import("@playwright/test").Page, nome: string) =>
  linhaDoAgente(page, nome).getByRole("button").filter({ hasText: nome });

test.afterAll(async () => {
  await db.remove(`sdr_agents?name=like.*${tag}*`);
});

test.describe("SDR · agentes", () => {
  test("cria agente pela tela e grava em sdr_agents", async ({ page }) => {
    const nome = `Qualificador ${tag}`;
    const prompt = "Pergunte renda, urgência, cidade e FGTS. Nunca prometa aprovação.";

    await page.goto("/sdr");
    await aguardarCarregamento(page);

    const painel = page.getByRole("tabpanel");
    await painel.getByRole("button", { name: /novo/i }).click();
    await painel.getByPlaceholder(/Orquestrador Face/).fill(nome);
    await painel.getByPlaceholder(/Você é um SDR da Faceimob/).fill(prompt);
    // Dois campos numéricos desde que o teto de turnos ganhou tela: pelo rótulo.
    // Ancorado no começo ("Temperatura (0.7)"): a linha da lista publica
    // "Excluir agente <nome>", e qualquer agente com "Temperatura" no nome
    // entrava no `/temperatura/i` frouxo. Os dois nomes acessíveis estão
    // certos — o seletor é que precisava dizer qual dos dois quer.
    await painel.getByLabel(/^temperatura/i).fill("0.3");
    await painel.getByRole("button", { name: /^salvar$/i }).click();

    await expect(page.getByText(/agente salvo/i)).toBeVisible();
    await expect(painel.getByText(nome, { exact: true })).toBeVisible();

    // O que importa: virou linha no banco com a configuração que foi digitada.
    const [gravado] = await porNome(nome);
    expect(gravado, "agente não chegou em sdr_agents").toBeTruthy();
    expect(gravado.system_prompt).toBe(prompt);
    expect(Number(gravado.temperature)).toBe(0.3);
    expect(gravado.role).toBe("qualifier");
    expect(gravado.active).toBe(true);
  });

  /**
   * `handoff_group_id` e `max_turns` existiam na tabela sem campo na tela.
   *
   * Sem o grupo, TODO lead qualificado caía na fila geral — não havia como
   * mandar o lead do agente de crédito para o grupo de crédito. Sem o teto,
   * uma conversa que nunca emite a tag rodava sem limite. Os dois consumidores
   * são o `sdr_handoff` (0064) e o `_shared/sdrAgent.ts`; aqui se prova a
   * parte determinística: a escolha chega ao banco.
   */
  test("grava a roleta de destino e o teto de respostas", async ({ page }) => {
    const nome = `Com destino ${tag}`;
    await db.insert("sdr_agents", { name: nome, role: "qualifier" });
    const [grupo] = await db.select<{ id: string; name: string }>(
      "distribution_groups?active=eq.true&kind=neq.general&select=id,name&limit=1",
    );
    expect(grupo, "cenário precisa de um grupo de distribuição específico").toBeTruthy();

    await page.goto("/sdr");
    await aguardarCarregamento(page);

    const painel = page.getByRole("tabpanel");
    await painel.getByText(nome, { exact: true }).click();
    await painel.getByLabel(/máximo de respostas/i).fill("4");
    await painel.getByLabel(/roleta que recebe/i).click();
    await page.getByRole("option", { name: grupo.name }).click();
    await painel.getByRole("button", { name: /^salvar$/i }).click();
    await expect(page.getByText(/agente salvo/i)).toBeVisible();

    await expect(async () => {
      const [gravado] = await porNome(nome);
      expect(gravado.handoff_group_id).toBe(grupo.id);
      expect(Number(gravado.max_turns)).toBe(4);
    }).toPass({ timeout: 10_000 });

    // O que a lista mostra sai do que foi gravado, não de um rótulo fixo.
    await expect(linhaDoAgente(page, nome)).toContainText("até 4 respostas");
  });

  // O trigger `sdr_agents_no_handoff_cycle` (0064) recusa A→B→A; a tela nem
  // oferece a opção, para o operador não escolher o que o banco vai negar.
  test("o seletor de handoff esconde quem fecharia um ciclo", async ({ page }) => {
    const a = `Ciclo A ${tag}`;
    const b = `Ciclo B ${tag}`;
    const [agenteA] = await db.insert<{ id: string }>("sdr_agents", { name: a, role: "qualifier" });
    await db.insert("sdr_agents", { name: b, role: "qualifier", handoff_to_agent_id: agenteA.id });

    await page.goto("/sdr");
    await aguardarCarregamento(page);

    const painel = page.getByRole("tabpanel");
    await painel.getByText(a, { exact: true }).click();
    await painel.getByLabel(/handoff para agente/i).click();
    // B já aponta para A: oferecer B aqui fecharia o laço A→B→A.
    await expect(page.getByRole("option", { name: b })).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  test("edita agente existente e a alteração persiste", async ({ page }) => {
    const nome = `Reengajador ${tag}`;
    await db.insert("sdr_agents", { name: nome, role: "reengager", system_prompt: "antes" });

    await page.goto("/sdr");
    await aguardarCarregamento(page);

    const painel = page.getByRole("tabpanel");
    // Pelo teclado: o botão de abrir é um `button` de verdade, então recebe foco
    // e responde ao Enter sem `tabIndex`/`onKeyDown` de imitação — e o botão de
    // excluir, agora irmão dele, continua na árvore de acessibilidade.
    const abrir = abrirAgente(page, nome);
    await abrir.focus();
    await abrir.press("Enter");
    await expect(painel.getByRole("heading", { name: /editar agente/i })).toBeVisible();

    await painel.getByPlaceholder(/Você é um SDR da Faceimob/).fill("depois da edição");
    await painel.getByRole("button", { name: /^salvar$/i }).click();
    await expect(page.getByText(/agente salvo/i)).toBeVisible();

    await expect(async () => {
      const [gravado] = await porNome(nome);
      expect(gravado.system_prompt).toBe("depois da edição");
    }).toPass({ timeout: 10_000 });
  });

  // O operador cadastrava "Reengajador (Remarketing)" no seletor e relia
  // "reengager" na linha ao lado, na mesma tela em português.
  test("a lista mostra o papel em português, igual ao seletor", async ({ page }) => {
    const nome = `Papel pt-BR ${tag}`;
    await db.insert("sdr_agents", { name: nome, role: "reengager" });

    await page.goto("/sdr");
    await aguardarCarregamento(page);

    const linha = linhaDoAgente(page, nome);
    await expect(linha).toContainText("Reengajador (Remarketing)");
    await expect(linha).not.toContainText("reengager");
  });

  /**
   * A confirmação saiu do `confirm()` nativo para o AlertDialog do app (o nativo
   * não é estilizado, ignora o tema e cortava o texto que enumera o que se
   * solta) — por isso não há mais `page.on("dialog")` aqui.
   */
  test("exclui agente e ele some de sdr_agents", async ({ page }) => {
    const nome = `Descartável ${tag}`;
    await db.insert("sdr_agents", { name: nome, role: "custom" });

    await page.goto("/sdr");
    await aguardarCarregamento(page);

    const linha = linhaDoAgente(page, nome);
    await expect(linha).toBeVisible();
    await linha.getByRole("button", { name: /excluir agente/i }).click();

    const dialogo = page.getByRole("alertdialog");
    await expect(dialogo).toContainText(nome);
    await dialogo.getByRole("button", { name: /excluir agente/i }).click();

    /**
     * O toast primeiro, e só depois o banco.
     *
     * `expect(linha).toHaveCount(0)` sozinho não provava nada: o AlertDialog do
     * Radix é modal e marca o resto da página com `aria-hidden` enquanto abre e
     * enquanto fecha, então `getByRole("tabpanel")` casa ZERO elementos e a
     * contagem passa antes de o DELETE sair. Foi assim que a leitura seguinte
     * disparou 130 ms antes da resposta do banco (trace da rodada: o DELETE
     * voltou 200 com `[{"id":"3addb…"}]`, ou seja, a linha foi apagada mesmo).
     *
     * "Agente excluído" só é escrito quando o DELETE volta com representação —
     * recusa da RLS casa 0 linhas, volta 200 com `[]` e a tela diz "Nada foi
     * gravado". É esse toast que autoriza conferir o banco.
     */
    await expect(page.getByText(/agente excluído/i)).toBeVisible();
    await expect(linha).toHaveCount(0);
    await expect(async () => {
      expect(await porNome(nome)).toHaveLength(0);
    }).toPass({ timeout: 10_000 });
  });

  /**
   * O aviso de exclusão contava só agentes encadeados. O efeito que a operação
   * sente é outro: a origem que apontava para ele fica sem agente e os leads
   * daquele formulário deixam de passar pela IA — em silêncio, porque a FK é
   * ON DELETE SET NULL.
   */
  test("o aviso de exclusão nomeia a origem que perde o agente", async ({ page }) => {
    const nome = `Com origem ${tag}`;
    const [agente] = await db.insert<{ id: string }>("sdr_agents", { name: nome, role: "qualifier" });
    const codigo = `e2e_dep_${tag.replace(/[^a-z0-9]/gi, "_").toLowerCase()}`;
    await db.insert("lead_sources", {
      code: codigo, label: `Origem dependente ${tag}`, channel: "meta", sdr_agent_id: agente.id, active: true,
    });

    try {
      await page.goto("/sdr");
      await aguardarCarregamento(page);
      await linhaDoAgente(page, nome).getByRole("button", { name: /excluir agente/i }).click();

      const dialogo = page.getByRole("alertdialog");
      await expect(dialogo).toContainText("1 origem de lead");
      // Cancelar não pode excluir nada: é o desfecho que o operador espera ao
      // ler a consequência e desistir.
      await dialogo.getByRole("button", { name: /cancelar/i }).click();
      expect(await porNome(nome), "cancelar excluiu o agente mesmo assim").toHaveLength(1);
    } finally {
      await db.remove(`lead_sources?code=eq.${codigo}`);
    }
  });

  /**
   * O `min`/`max` do input só vale para as setas do navegador: digitar 5 passava
   * e o CHECK do banco recusava com a frase genérica de "campo fora do valor
   * permitido", sem dizer qual campo.
   */
  test("temperatura fora de 0–2 é recusada com o campo nomeado", async ({ page }) => {
    const nome = `Temperatura ${tag}`;
    await db.insert("sdr_agents", { name: nome, role: "custom" });

    await page.goto("/sdr");
    await aguardarCarregamento(page);
    const painel = page.getByRole("tabpanel");
    await painel.getByText(nome, { exact: true }).click();

    // O agente de teste se chama "Temperatura <tag>": sem a âncora, o rótulo
    // casava também o botão "Excluir agente Temperatura …" da lista ao lado.
    await painel.getByLabel(/^temperatura/i).fill("5");
    await painel.getByRole("button", { name: /^salvar$/i }).click();

    await expect(page.getByText(/temperatura precisa ficar entre 0 e 2/i)).toBeVisible();
    const [gravado] = await db.select<{ temperature: number }>(
      `sdr_agents?name=eq.${encodeURIComponent(nome)}&select=temperature`,
    );
    expect(Number(gravado.temperature), "valor inválido não podia chegar ao banco").toBeLessThanOrEqual(2);
  });

  // Era defeito duplo: `<SelectItem value="">Nenhum` derrubava o editor (o Radix
  // recusa valor vazio) e, mesmo gravado, `handoff_to_agent_id` não tinha leitor
  // — a delegação configurada nunca acontecia. A leitura vive em
  // _shared/sdrAgent.ts e só roda com a chave da OpenAI; aqui se prova a parte
  // determinística: a escolha chega ao banco.
  test("grava o agente de handoff escolhido", async ({ page }) => {
    const nome = `Com handoff ${tag}`;
    await db.insert("sdr_agents", { name: nome, role: "qualifier" });
    const [alvo] = await db.select<{ id: string; name: string }>(
      "sdr_agents?is_orchestrator=eq.true&active=eq.true&select=id,name&limit=1",
    );
    expect(alvo, "seed sem orquestrador — cenário incompleto").toBeTruthy();

    await page.goto("/sdr");
    await aguardarCarregamento(page);

    const painel = page.getByRole("tabpanel");
    await painel.getByText(nome, { exact: true }).click();
    await painel.getByRole("combobox").filter({ hasText: /nenhum/i }).click();
    await page.getByRole("option", { name: alvo.name }).click();
    await painel.getByRole("button", { name: /^salvar$/i }).click();
    await expect(page.getByText(/agente salvo/i)).toBeVisible();

    await expect(async () => {
      const [gravado] = await db.select<{ handoff_to_agent_id: string | null }>(
        `sdr_agents?name=eq.${encodeURIComponent(nome)}&select=handoff_to_agent_id`,
      );
      expect(gravado.handoff_to_agent_id).toBe(alvo.id);
    }).toPass({ timeout: 10_000 });
  });
});

test.describe("SDR · playground", () => {
  // Alvo local não tem chave da OpenAI: a function responde 503 dizendo qual
  // credencial falta. No remoto, com a chave no cofre, o agente responde de
  // verdade. Os dois desfechos valem; o que não pode é a mensagem ficar órfã
  // com o erro técnico antigo ("conversation_id ou lead_id obrigatório") nem a
  // tela cair.
  test.use({ errosEsperados: [/status of 5\d\d/i] });

  test("responde com a chave configurada, ou diz qual credencial falta", async ({ page }) => {
    await page.goto("/sdr");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: /playground/i }).click();

    const painel = page.getByRole("tabpanel");
    // Enter envia (onKeyDown do input).
    await painel.getByPlaceholder(/Simule o lead/).fill("Quero um apartamento de 2 quartos");
    await painel.getByPlaceholder(/Simule o lead/).press("Enter");

    const desfecho = painel.locator("[data-bubble='assistant'], [data-bubble='error']").first();
    await expect(desfecho).toBeVisible({ timeout: 30_000 });
    await expect(painel.getByText(/agente pensando/i)).toBeHidden();
    // A mensagem do usuário continua no log e o campo volta a aceitar texto.
    await expect(painel.getByText("Quero um apartamento de 2 quartos")).toBeVisible();
    await expect(painel.getByPlaceholder(/Simule o lead/)).toBeEnabled();
    await expect(painel.getByText(/conversation_id ou lead_id/i)).toHaveCount(0);

    if ((await desfecho.getAttribute("data-bubble")) === "error") {
      // Sem credencial: o aviso diz o que falta e onde cadastrar.
      await expect(desfecho).toContainText(/openai/i);
      return;
    }

    // Com credencial: a simulação ficou gravada numa conversa do lead de teste
    // do Playground, que nasce 'discarded' — fora da roleta.
    const [lead] = await db.select<{ id: string; status: string }>(
      "leads?utm_source=eq.sdr_playground&select=id,status&limit=1",
    );
    expect(lead, "lead de teste do Playground não foi criado").toBeTruthy();
    expect(lead.status).toBe("discarded");
    const [conversa] = await db.select<{ id: string }>(
      `sdr_conversations?lead_id=eq.${lead.id}&select=id&order=created_at.desc&limit=1`,
    );
    const mensagens = await db.select<{ author: string }>(
      `sdr_messages?conversation_id=eq.${conversa.id}&select=author`,
    );
    expect(mensagens.some((m) => m.author === "agent")).toBe(true);
  });

  // Mesma causa do handoff, mesma correção: o seletor "Automático
  // (orquestrador)" também usava valor vazio.
  test("permite escolher o agente inicial da simulação", async ({ page }) => {
    await page.goto("/sdr");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: /playground/i }).click();

    await page.getByRole("tabpanel").getByRole("combobox").click();
    await expect(page.getByRole("option", { name: /automático/i })).toBeVisible();
  });

  /**
   * A regra 8 aplicada ao Playground: papel que vê o campo é papel que a
   * function aceita.
   *
   * Simular GRAVA conversa (`sdr_conversations`/`sdr_messages`) e gasta crédito
   * da OpenAI a cada turno, então `sdr-agent-chat` exige, além de `menu.sdr`,
   * um dos papéis que a RLS deixa escrever (admin/marketing/sdr). `director`
   * tem `menu.sdr` e não tem escrita: se a tela oferecesse o campo, ele
   * digitaria a simulação para receber 403 depois — e nem conseguiria reler a
   * própria conversa na aba Conversas. As DUAS barreiras são cobradas aqui,
   * porque esconder o campo sem a porta do servidor não protege nada.
   */
  test("papel que só consulta não vê o campo do playground, e a function recusa", async ({ browser, baseURL }) => {
    if (!baseURL) throw new Error("baseURL do Playwright ausente");
    const diretor = userFor("director");
    const sessao = await mintSession(diretor.email);

    const contexto = await browser.newContext({ baseURL, storageState: storageStateFor(sessao, baseURL) });
    const pagina = await contexto.newPage();
    try {
      await pagina.goto("/sdr");
      await aguardarCarregamento(pagina);
      await pagina.getByRole("tab", { name: /playground/i }).click();

      const painel = pagina.getByRole("tabpanel");
      await expect(painel.getByPlaceholder(/Simule o lead/)).toHaveCount(0);
      // Campo escondido sem motivo escrito é tela quebrada.
      await expect(painel.getByText(/admin, marketing e SDR/i)).toBeVisible();
      await expect(painel.getByRole("button", { name: /testar chave da openai/i })).toHaveCount(0);
    } finally {
      await contexto.close();
    }

    // A porta do servidor, sem navegador: nem com o JWT na mão o papel simula.
    const res = await fetch(`${alvoE2E.supabaseUrl}/functions/v1/sdr-agent-chat`, {
      method: "POST",
      headers: {
        apikey: alvoE2E.anonKey,
        Authorization: `Bearer ${sessao.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message: `tentativa do diretor ${tag}` }),
    });
    expect(res.status, "papel sem escrita não pode gravar conversa nem gastar a chave").toBe(403);
    expect((await res.json()).code).toBe("role_forbidden");
  });
});

/**
 * Estado de carregamento e de erro do módulo.
 *
 * As cinco consultas do SdrModule alimentam quatro abas cujo vazio é uma frase
 * DEFINITIVA ("Nenhum agente…", "Nenhuma origem cadastrada.", "Nenhuma lista
 * ainda.", "Nenhum template cadastrado."). Sem flag de carregamento elas
 * apareciam antes de a resposta chegar; e, quando a carga falhava, a tela dizia
 * ao mesmo tempo "não consegui carregar" e "não existe nada".
 */
test.describe(() => {
  test.use({ errosEsperados: [/status of 500/i] });

  test("falha ao carregar não convive com a frase de vazio das abas", async ({ page }) => {
    const rota = "**/rest/v1/sdr_agents*";
    await page.route(rota, (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "boom" }) }));

    await page.goto("/sdr");
    await aguardarCarregamento(page);

    await expect(page.getByText(/Não foi possível carregar os dados do SDR/)).toBeVisible();
    // Nenhuma aba pode afirmar que não existe nada cadastrado.
    await expect(page.getByText("Nenhum agente.", { exact: false })).toHaveCount(0);
    await expect(page.getByText("boom")).toHaveCount(0);

    await page.unroute(rota);
    await page.getByRole("button", { name: "Tentar novamente" }).click();
    await expect(page.getByText(/Não foi possível carregar os dados do SDR/)).toHaveCount(0);
    await expect(page.getByRole("tabpanel")).toBeVisible();
  });
});
