/**
 * Pipeline · persistência do negócio ponta a ponta (visão admin).
 *
 * Rede de segurança da correção de 08/08: até então o modal de detalhe mostrava
 * "Alterações salvas" e não gravava nada, e a criação de negócio só existia em
 * memória. Por isso toda asserção aqui termina no banco (`db.select`) e o
 * caminho crítico ainda recarrega a página antes de conferir — toast e estado
 * de React não provam gravação.
 */
import { test, expect, db, runTag } from "../support/fixtures";
import { mintSession } from "../support/session";
import { resolveTarget } from "../support/target";
import { userFor } from "../support/users";
import {
  abrirDetalhe,
  abrirPipeline,
  buscar,
  campo,
  clientesDe,
  confirmarModal,
  escolher,
  idDaEtapa,
  limparNegocios,
  linhaDoNegocio,
  negocioPorCliente,
  opcoesDe,
  participantesDe,
  primeiraConstrutora,
  seletor,
  semearNegocio,
} from "../helpers/negocio";

const marca = runTag();
const nomeCliente = (prefixo: string) => `${prefixo} ${marca}`;

test.afterAll(async () => {
  await limparNegocios(marca);
});

test("cria negócio pela tela e grava deals, deal_clients e deal_participants", async ({ page }) => {
  const cliente = nomeCliente("Ana Criacao");
  const construtora = await primeiraConstrutora();
  const [empreendimento] = await db.select<{ name: string }>(
    `developer_projects?developer_id=eq.${construtora.id}&select=name&order=name&limit=1`,
  );

  await abrirPipeline(page);
  await page.getByRole("button", { name: /adicionar negócio/i }).click();

  const modal = page.getByRole("dialog");
  await expect(modal.getByRole("button", { name: /criar negócio/i })).toBeVisible();

  await campo(modal, "Cliente *").fill(cliente);
  await escolher(seletor(modal, "Construtora *"), construtora.name);
  await escolher(seletor(modal, "Empreendimento"), empreendimento.name);
  await campo(modal, "Bloco | unidade").fill("101");
  await escolher(seletor(modal, "Corretor 1 *"), "E2E Corretor");
  await escolher(seletor(modal, "Gerente 1 *"), "E2E Gerente");
  await campo(modal, "VGV bruto").fill("500000");
  await modal.getByRole("button", { name: /criar negócio/i }).click();
  await expect(modal).toBeHidden();

  const negocio = await negocioPorCliente(cliente);
  expect(negocio.unit).toBe("101");
  expect(Number(negocio.vgv_gross)).toBe(500000);
  expect(negocio.developer_id).toBe(construtora.id);
  expect(negocio.project_id).not.toBeNull();

  const clientes = await clientesDe(negocio.id);
  expect(clientes).toHaveLength(1);
  expect(clientes[0].full_name).toBe(cliente);
  expect(clientes[0].ordinal).toBe(1);

  const participantes = await participantesDe(negocio.id);
  const corretores = participantes.filter((p) => p.role === "broker");
  expect(corretores.map((p) => p.profile_id)).toEqual([await db.profileIdOf("broker")]);
  expect(Number(corretores[0].share_pct)).toBe(100);
  expect(participantes.filter((p) => p.role === "manager").map((p) => p.profile_id))
    .toContain(await db.profileIdOf("manager"));

  // Só existe de verdade se aparece na listagem depois de recarregar.
  await abrirPipeline(page);
  await buscar(page, cliente);
  await expect(linhaDoNegocio(page, cliente)).toBeVisible();
});

test("quem cria o negócio sem informar corretor não vira Corretor 1 nem leva o rateio", async ({ page }) => {
  // `deals_add_creator_participant` (0012) gravava o autor como `'broker'`
  // sempre. Sem Corretor 1 no formulário, `saveLegacyDeal` não roda a limpeza
  // desse papel — e o admin (ou gerente, ou diretor) ficava como "Corretor 1"
  // com 100% do rateio de VGV e os pontos de venda do game. A 0048 passou a
  // gravar o papel real de quem cria; admin e CCA não ganham linha nenhuma.
  //
  // O cenário só vale se o admin da suíte estiver na condição real: todo perfil
  // novo ganha `broker` de `handle_new_auth_user` (0002) e `provisionE2EUsers`
  // não o retira. É contra esse `broker` que o teste corre — sem ele, o caso é
  // trivial e não prova nada.
  const adminId = await db.profileIdOf("admin");
  const papeisDoAdmin = await db.select<{ role: string }>(
    `user_roles?profile_id=eq.${adminId}&select=role`,
  );
  expect(papeisDoAdmin.map((r) => r.role), "o admin da suíte carrega o broker do cadastro")
    .toContain("broker");

  const cliente = nomeCliente("Nina Sem Corretor");
  const construtora = await primeiraConstrutora();
  const [empreendimento] = await db.select<{ name: string }>(
    `developer_projects?developer_id=eq.${construtora.id}&select=name&order=name&limit=1`,
  );

  await abrirPipeline(page);
  await page.getByRole("button", { name: /adicionar negócio/i }).click();

  const modal = page.getByRole("dialog");
  await campo(modal, "Cliente *").fill(cliente);
  await escolher(seletor(modal, "Construtora *"), construtora.name);
  await escolher(seletor(modal, "Empreendimento"), empreendimento.name);
  await escolher(seletor(modal, "Gerente 1 *"), "E2E Gerente");
  await campo(modal, "VGV bruto").fill("400000");
  await modal.getByRole("button", { name: /criar negócio/i }).click();
  await expect(modal).toBeHidden();

  const negocio = await negocioPorCliente(cliente);
  const participantes = await participantesDe(negocio.id);
  expect(participantes.filter((p) => p.role === "broker"), "negócio sem corretor nasce sem corretor")
    .toHaveLength(0);
  expect(participantes.map((p) => p.profile_id), "o admin que criou não participa do negócio")
    .not.toContain(adminId);
  // Só o gerente do formulário: o gatilho não acrescentou ninguém.
  expect(participantes.map((p) => p.role)).toEqual(["manager"]);

  // E a coluna "Corretor 1" da tabela mostra a ausência, não o nome de quem
  // apenas cadastrou.
  await abrirPipeline(page);
  await buscar(page, cliente);
  await expect(linhaDoNegocio(page, cliente)).not.toContainText("E2E Admin");
});

/**
 * "Construtora *": o asterisco passou a valer.
 *
 * O rótulo prometia obrigatoriedade e nada o cobrava — `handleSave` só exigia
 * cliente e um participante, e o banco aceita `developer_id` nulo. O negócio
 * entrava, o cartão do kanban passava a mostrar "Sem construtora" e a
 * conferência documental, que escolhe os documentos PELA construtora, ficava
 * sem como pedir nada.
 *
 * "Empreendimento" NÃO entra nesta regra e por isso não tem asterisco: o Select
 * não aceita digitação livre e construtora sem nenhum empreendimento cadastrado
 * é caso real (`e2e/cca/esteira.ts` monta exatamente esse cenário), então
 * cobrá-lo fechava o "Criar negócio" num beco sem saída. A outra porta do mesmo
 * registro, `ConvertLeadDialog`, já o trata como opcional.
 */
test("negócio sem construtora não é criado, e a tela diz por quê", async ({ page }) => {
  const cliente = nomeCliente("Sem Construtora");

  await abrirPipeline(page);
  await page.getByRole("button", { name: /adicionar negócio/i }).click();

  const modal = page.getByRole("dialog");
  await campo(modal, "Cliente *").fill(cliente);
  await escolher(seletor(modal, "Corretor 1 *"), "E2E Corretor");
  await modal.getByRole("button", { name: /criar negócio/i }).click();

  // A frase nomeia o campo e o motivo — não é "um dos campos está inválido".
  await expect(page.getByText(/escolha a construtora/i)).toBeVisible();

  // E nada foi gravado: o modal continua aberto com o que o operador digitou.
  await expect(modal).toBeVisible();
  expect(
    await db.select(`deal_clients?full_name=eq.${encodeURIComponent(cliente)}&select=deal_id`),
    "o negócio sem construtora não pode existir no banco",
  ).toEqual([]);
});

/**
 * O diálogo de fechar mês — sem confirmar.
 *
 * O fechamento em si vive em `fechamento-mes.spec.ts`, que não roda no alvo
 * remoto (encerra a temporada aberta do game). O que dá para provar em
 * qualquer alvo, e importa tanto quanto: o operador **vê o que vai congelar
 * antes de apertar**. Até aqui o período era fixado na temporada aberta do
 * game, sem escolha e sem preview — e um mês com negócio ficava sem nenhuma
 * tela capaz de congelá-lo (medido: 26 dos 32 negócios em 08/2026 com a
 * temporada aberta em 09/2026).
 */
test("o diálogo de fechar mês deixa escolher o período e diz o que vai congelar", async ({ page }) => {
  // Mês futuro e distante de propósito: o preview conta ESTES negócios, e
  // nenhum outro spec mexe em 03/2027.
  const cliente = nomeCliente("Paula Fechamento");
  await semearNegocio({ cliente, monthBase: "2027-03-01" });
  // A VENDA no mesmo mês é o caso que separa o preview certo do errado. A RPC
  // `close_month_and_season` move só `outcome = 'open'`; enquanto a tela
  // contava `deal.active` (que inclui `won`), ela prometia mover a venda E a
  // contava de novo entre os congelados — as duas linhas somavam mais do que o
  // mês tem. Com um aberto e um vendido, "1" e "1" só batem se o predicado for
  // o mesmo do `where` da RPC.
  const vendido = nomeCliente("Vera Vendida");
  const negocioVendido = await semearNegocio({ cliente: vendido, monthBase: "2027-03-01" });
  await db.update(`deals?id=eq.${negocioVendido.id}`, {
    outcome: "won",
    closed_at: new Date().toISOString(),
  });
  const fechadosAntes = await db.select("closed_months?select=period");

  await abrirPipeline(page);
  await page.getByRole("button", { name: /^fechar mês$/i }).click();

  const dialogo = page.getByRole("alertdialog");
  const periodo = seletor(dialogo, "Período a fechar");

  // O mês do negócio semeado é oferecido, e nenhum mês já congelado aparece.
  const opcoes = (await opcoesDe(periodo)).map((texto) => texto.split(" — ")[0]);
  expect(opcoes).toContain("03/2027");
  const fechados = (await db.select<{ period: string }>("closed_months?select=period"))
    .map((linha) => `${linha.period.slice(5, 7)}/${linha.period.slice(0, 4)}`);
  for (const mes of fechados) expect(opcoes, `${mes} já está fechado`).not.toContain(mes);

  await escolher(periodo, "03/2027");

  // O preview conta o que a RPC fará: proposta aberta migra, resultado congela.
  // A venda NÃO entra na primeira linha, e as duas linhas particionam o mês.
  await expect(dialogo).toContainText("1 proposta(s) aberta(s) passam para 04/2027");
  await expect(dialogo).toContainText("1 resultado(s) ficam congelados em 03/2027");
  // E o botão carrega o período escolhido, não o da temporada.
  await expect(dialogo.getByRole("button", { name: "Fechar 03/2027", exact: true })).toBeVisible();

  await dialogo.getByRole("button", { name: /^cancelar$/i }).click();
  await expect(dialogo).toBeHidden();
  expect(await db.select("closed_months?select=period"), "abrir o diálogo não congela nada")
    .toEqual(fechadosAntes);
});

/**
 * O cadeado de mês fechado no CARTÃO do kanban.
 *
 * A tabela já mostrava o cadeado incondicionalmente (`dealLock`), e o cartão
 * não: ele calculava `canWrite && canExit` por conta própria e renderizava o
 * cadeado só no ramo em que o cartão JÁ era imóvel por outro motivo. Resultado:
 * em mês congelado o gerente (que tem `can_exit` em "Contrato") continuava com
 * alça, `draggable=true` e os dois botões de mover, e o gesto morria no
 * `blockedMoveReason` com toast vermelho.
 *
 * Aqui o caso é o do ADMIN, que é o mais difícil de acertar: ele passa pelo
 * `deals_guard_closed_month` (`is_admin()` curto-circuita), então continua
 * arrastando — e por isso mesmo precisa VER que o mês está congelado, em vez
 * de descobrir depois. Cartão e linha saem da MESMA função.
 */
test("no kanban do admin o cartão de mês fechado avisa e continua arrastável", async ({ page }) => {
  const mesIso = "2027-07-01";
  const cliente = nomeCliente("Ida Congelada");
  // A ordem não é opcional: `deals_guard_closed_month` recusa até o INSERT em
  // mês já fechado, então o negócio nasce antes do congelamento.
  await semearNegocio({ cliente, monthBase: mesIso });
  expect(
    await db.select(`closed_months?period=eq.${mesIso}&select=period`),
    "07/2027 precisa começar aberto — outro teste não limpou",
  ).toEqual([]);
  await db.insert("closed_months", { period: mesIso, notes: `fechado pelo teste ${marca}` });

  try {
    await abrirPipeline(page);
    await buscar(page, cliente);
    await page.getByRole("button", { name: /ver em kanban/i }).click();

    const cartao = page.getByRole("button", { name: new RegExp(`^${cliente}`) });
    await expect(cartao).toBeVisible();
    await expect(cartao, "o admin não perde o arraste em mês fechado")
      .toHaveAttribute("draggable", "true");
    await expect(cartao, "e o cartão diz que o mês está congelado")
      .toHaveAccessibleName(/mês 07\/2027 fechado/i);
  } finally {
    // O mês volta a ficar aberto mesmo se a asserção falhar: `closed_months` é
    // estado global e o banco é compartilhado com os outros specs.
    await db.remove(`closed_months?period=eq.${mesIso}`);
    // O DELETE acima é limpeza, não reabertura — mas o gatilho
    // `closed_months_log_reopen` (0076) grava a linha em toda saída da tabela,
    // com `reopened_by` nulo. Apagá-la aqui é o que impede a auditoria de
    // reabertura de encher de evento que nunca aconteceu. O `catch` cobre o
    // banco que ainda não tem a migration.
    await db.remove(`month_reopenings?period=eq.${mesIso}`).catch(() => undefined);
  }
});

/**
 * Status 2 pelo MODAL — o gravador que ninguém cobria.
 *
 * Os testes de Status 2 exercitavam o Select da tabela. Pelo modal havia um
 * defeito silencioso: a tela mostra em "Status 2" o rótulo DERIVADO do desfecho
 * quando `status_detail` é nulo (o caso de 28 dos 32 negócios da homologação),
 * e o primeiro salvamento persistia essa dedução como se fosse escolha do
 * operador.
 */
test("salvar pelo modal não inventa Status 2, e o escolhido grava", async ({ page }) => {
  const cliente = nomeCliente("Sergio Status2");
  const negocio = await semearNegocio({ cliente, brokerId: await db.profileIdOf("broker") });
  const [antes] = await db.select<{ status_detail: string | null }>(
    `deals?id=eq.${negocio.id}&select=status_detail`,
  );
  expect(antes.status_detail, "o cenário começa sem Status 2 escolhido").toBeNull();

  await abrirPipeline(page);
  await buscar(page, cliente);
  let modal = await abrirDetalhe(page, cliente);
  // A tela mostra "PROPOSTA" porque deduziu de `outcome`, não porque alguém
  // escolheu. Salvar outra coisa não pode transformar dedução em dado.
  await campo(modal, "Bloco | unidade").fill("301");
  await confirmarModal(page, modal);

  await expect.poll(async () => (await negocioPorCliente(cliente)).unit).toBe("301");
  expect((await negocioPorCliente(cliente)).status_detail, "rótulo derivado não vira escolha")
    .toBeNull();

  await abrirPipeline(page);
  await buscar(page, cliente);
  modal = await abrirDetalhe(page, cliente);
  await escolher(seletor(modal, "Status da venda (Status 2)"), "16. PENDENTE");
  await confirmarModal(page, modal);

  await expect
    .poll(async () => (await negocioPorCliente(cliente)).status_detail)
    .toBe("16. PENDENTE");
});

test("SDR não cadastra negócio manual: o banco recusa antes de virar Corretor 1", async () => {
  // Irmão do caso acima, pela porta que a 0048 achou fechada e não estava. O
  // comentário dela dizia que `sdr`/`marketing`/`partner` não chegam ao gatilho
  // porque "deals_insert recusa" — e o `with check` era
  // `has_any_role(admin, director, manager, broker, cca)`, que o `broker` de
  // cadastro (`handle_new_auth_user`) fazia o SDR passar. Ele criava o negócio,
  // o gatilho o escolhia como CORRETOR e ele levava 100% do rateio de VGV e os
  // pontos de 'venda'.
  //
  // A 0053 decide pelo papel EFETIVO nos DOIS pontos: a policy e o gatilho.
  // Fechar só o gatilho deixaria o SDR gravar o negócio e tomar 42501 no
  // `deal_clients` logo depois (a policy de lá exige `can_edit_deal`, que sai de
  // `deal_participants`) — negócio órfão em vez de rateio roubado.
  //
  // Sem navegador de propósito: o que está sob teste é o INSERT, abaixo do
  // formulário. Vai com o JWT real do SDR + a chave anônima — exatamente o que o
  // navegador dele carrega, com RLS e gatilho valendo, nada de service_role.
  const sdrId = await db.profileIdOf("sdr");
  const papeisDoSdr = await db.select<{ role: string }>(
    `user_roles?profile_id=eq.${sdrId}&select=role`,
  );
  expect(papeisDoSdr.map((r) => r.role), "o SDR da suíte carrega o broker do cadastro")
    .toContain("broker");

  const alvo = resolveTarget();
  const construtora = await primeiraConstrutora();
  const etapa = await idDaEtapa("proposal");
  // Mês distante: `deals_guard_closed_month` recusa qualquer INSERT no mês
  // fechado, e o fechamento é exercitado por outros specs no mês corrente.
  const negocioNovo = {
    developer_id: construtora.id,
    stage_id: etapa,
    month_base: "2031-09-01",
    vgv_gross: 300000,
  };

  const criarComo = async (papel: "sdr" | "broker") => {
    const sessao = await mintSession(userFor(papel).email);
    const res = await fetch(`${alvo.supabaseUrl}/rest/v1/deals`, {
      method: "POST",
      headers: {
        apikey: alvo.anonKey,
        Authorization: `Bearer ${sessao.access_token}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(negocioNovo),
    });
    return { status: res.status, corpo: await res.text() };
  };

  const doSdr = await criarComo("sdr");
  expect(doSdr.status, `o SDR não escreve em deals: ${doSdr.corpo.slice(0, 200)}`).toBe(403);
  expect(doSdr.corpo, "recusa tem que vir do RLS, não de outro erro").toContain("42501");

  // Contraprova obrigatória: a policy não pode ter ficado verde barrando todo
  // mundo. O corretor puro continua criando — e é ELE que o gatilho inscreve,
  // com os 100% do rateio.
  const doCorretor = await criarComo("broker");
  expect(doCorretor.status, `o corretor continua criando negócio: ${doCorretor.corpo.slice(0, 200)}`)
    .toBe(201);
  const [negocio] = JSON.parse(doCorretor.corpo) as { id: string }[];
  // Nome marcado logo em seguida: é por ele que `limparNegocios` acha o negócio.
  await db.insert("deal_clients", {
    deal_id: negocio.id,
    ordinal: 1,
    full_name: nomeCliente("Hugo Contraprova"),
  });

  // Um corretor só, e é ele. Gerente e diretor da equipe entram junto por
  // `deal_participants_autofill`, com 0% — por isso a conferência é do recorte
  // de 'broker', não da lista inteira.
  const corretores = (await participantesDe(negocio.id)).filter((p) => p.role === "broker");
  expect(corretores.map((p) => p.profile_id)).toEqual([await db.profileIdOf("broker")]);
  expect(Number(corretores[0].share_pct), "corretor único fica com 100% do rateio").toBe(100);
});

test("cabeçalho descreve o conjunto filtrado: contagem e VGV do mesmo recorte", async ({ page }) => {
  // A contagem já saía da lista filtrada e o VGV, da base inteira: "3
  // negócio(s) ativo(s) · R$ 12 mi em VGV" descrevia dois conjuntos na mesma
  // frase. Mês próprio para o recorte não depender do resto da base.
  await semearNegocio({ cliente: nomeCliente("Otavio Recorte A"), monthBase: "2031-07-01", vgvGross: 400000 });
  await semearNegocio({ cliente: nomeCliente("Otavio Recorte B"), monthBase: "2031-07-01", vgvGross: 600000 });

  await abrirPipeline(page);
  const resumo = page.locator("header p").filter({ hasText: /negócio\(s\) ativo\(s\)/ });

  await page.getByRole("button", { name: /^filtrar$/i }).click();
  await escolher(page.getByRole("combobox", { name: "Mês-base" }), "07/2031");

  await expect(resumo).toContainText("2 negócio(s) ativo(s)");
  await expect(resumo, "o VGV precisa ser o dos 2 negócios filtrados").toContainText("1.000.000");
});

test("indicador de visita acende no cartão quando existe visita agendada", async ({ page }) => {
  // `listLegacyDeals` não lia `visits` — `visit_date` nascia sempre `undefined`
  // e o selo do cartão (e o ícone da tabela) ficava apagado mesmo com a visita
  // gravada. A visita entra pelo banco de propósito: o que está sob teste é a
  // LEITURA, não o diálogo de agendamento.
  const comVisita = nomeCliente("Paula Com Visita");
  const semVisita = nomeCliente("Paula Sem Visita");
  const negocio = await semearNegocio({ cliente: comVisita, brokerId: await db.profileIdOf("broker") });
  await semearNegocio({ cliente: semVisita, brokerId: await db.profileIdOf("broker") });

  await db.insert("visits", {
    deal_id: negocio.id,
    broker_id: await db.profileIdOf("broker"),
    scheduled_at: "2031-07-15T14:00:00+00:00",
  });

  await abrirPipeline(page);
  await buscar(page, comVisita);
  await page.getByRole("button", { name: /ver em kanban/i }).click();

  // O cartão é o `<article>`, não o `role="button"` de dentro dele.
  //
  // Os selos de estado (visita, observação, parado) moram no RODAPÉ, que é
  // irmão do `role="button"` de propósito: descendente de `button` é
  // presentacional na especificação ARIA, e lá dentro o `aria-label` deste
  // ícone sumiria do leitor de tela (`nested-interactive` do axe). Ancorado no
  // botão, este teste procurava o selo onde ele não pode estar — e a
  // contraprova abaixo passaria mesmo com o indicador quebrado, porque
  // `toHaveCount(0)` num escopo errado é verdade sempre.
  const cartao = (cliente: string) =>
    page.getByRole("article").filter({ hasText: cliente });

  await expect(cartao(comVisita).locator('[aria-label="Visita agendada"]')).toBeVisible();

  // Contraprova: sem linha em `visits` o selo continua ausente — o indicador
  // acende pela visita, não por qualquer negócio.
  await page.getByRole("button", { name: /ver em tabela/i }).click();
  await buscar(page, semVisita);
  await page.getByRole("button", { name: /ver em kanban/i }).click();
  await expect(cartao(semVisita)).toBeVisible();
  await expect(cartao(semVisita).locator('[aria-label="Visita agendada"]')).toHaveCount(0);
});

test("catálogos de construtora e corretor vêm do banco, não de lista fixa", async ({ page }) => {
  const construtoras = await db.select<{ name: string }>(
    "developers?active=is.true&select=name&order=name",
  );
  expect(construtoras.length, "seed sem construtoras — cenário inválido").toBeGreaterThan(0);

  await abrirPipeline(page);
  await page.getByRole("button", { name: /adicionar negócio/i }).click();
  const modal = page.getByRole("dialog");

  expect(await opcoesDe(seletor(modal, "Construtora *"))).toEqual(
    construtoras.map((c) => c.name),
  );

  const corretores = await opcoesDe(seletor(modal, "Corretor 1 *"));
  expect(corretores.length).toBeGreaterThan(0);
  expect(corretores).toContain("E2E Corretor");
});

test("modal de detalhe: cliente, CPF, VGV, corretores e gerentes sobrevivem ao reload", async ({ page }) => {
  const original = nomeCliente("Bruno Original");
  const corrigido = nomeCliente("Bruno Corrigido");
  const negocio = await semearNegocio({ cliente: original });

  await abrirPipeline(page);
  await buscar(page, original);
  const modal = await abrirDetalhe(page, original);

  await campo(modal, "Cliente *").fill(corrigido);
  await campo(modal, "CPF").first().fill("529.982.247-25");
  await campo(modal, "VGV bruto").fill("750000");
  await campo(modal, "Percentual de desconto").fill("10");
  await escolher(seletor(modal, "Corretor 1 *"), "E2E Corretor");
  await escolher(seletor(modal, "Corretor 2"), "E2E Corretor Rival");
  await escolher(seletor(modal, "Gerente 1 *"), "E2E Gerente");
  await escolher(seletor(modal, "Gerente 2"), "E2E Diretor");
  await confirmarModal(page, modal);

  // 1) Banco: é aqui que a regressão de 08/08 aparecia (tela dizia "salvo",
  //    banco continuava com o valor antigo).
  const gravado = await negocioPorCliente(corrigido);
  expect(gravado.id).toBe(negocio.id);
  expect(Number(gravado.vgv_gross)).toBe(750000);
  expect(Number(gravado.discount_pct)).toBe(10);
  expect(Number(gravado.vgv_net)).toBe(675000);

  const clientes = await clientesDe(negocio.id);
  expect(clientes[0].full_name).toBe(corrigido);
  expect(clientes[0].cpf).toBe("529.982.247-25");

  const participantes = await participantesDe(negocio.id);
  expect(participantes.filter((p) => p.role === "broker").map((p) => p.profile_id).sort())
    .toEqual([await db.profileIdOf("broker"), await db.profileIdOf("brokerRival")].sort());
  // Ata 23/07: gerente 1 e 2 escolhidos na tela viram participante 'manager'.
  const gerentes = participantes.filter((p) => p.role === "manager").map((p) => p.profile_id);
  expect(gerentes).toContain(await db.profileIdOf("manager"));
  expect(gerentes).toContain(await db.profileIdOf("director"));

  // 2) Tela, depois de recarregar de verdade.
  await abrirPipeline(page);
  await buscar(page, corrigido);
  const reaberto = await abrirDetalhe(page, corrigido);
  await expect(campo(reaberto, "Cliente *")).toHaveValue(corrigido);
  await expect(campo(reaberto, "CPF").first()).toHaveValue("529.982.247-25");
  await expect(campo(reaberto, "VGV bruto")).toHaveValue("750000");
  await expect(seletor(reaberto, "Corretor 1 *")).toContainText("E2E Corretor");
  await expect(seletor(reaberto, "Gerente 1 *")).toContainText("E2E Gerente");
});

test("rateio de VGV fecha 100% com 2 e com 3 corretores", async ({ page }) => {
  const cliente = nomeCliente("Carla Rateio");
  const negocio = await semearNegocio({ cliente });

  await abrirPipeline(page);
  await buscar(page, cliente);
  let modal = await abrirDetalhe(page, cliente);
  await escolher(seletor(modal, "Corretor 1 *"), "E2E Corretor");
  await escolher(seletor(modal, "Corretor 2"), "E2E Corretor Rival");
  await confirmarModal(page, modal);

  let corretores = (await participantesDe(negocio.id)).filter((p) => p.role === "broker");
  expect(corretores).toHaveLength(2);
  expect(corretores.map((p) => Number(p.share_pct))).toEqual([50, 50]);

  await buscar(page, cliente);
  modal = await abrirDetalhe(page, cliente);
  await escolher(seletor(modal, "Corretor 3"), "E2E Diretor Corretor");
  await confirmarModal(page, modal);

  corretores = (await participantesDe(negocio.id)).filter((p) => p.role === "broker");
  expect(corretores).toHaveLength(3);
  const soma = corretores.reduce((total, p) => total + Number(p.share_pct), 0);
  expect(soma, "o resto do arredondamento tem que sobrar para alguém").toBe(100);
  for (const p of corretores) expect(Number(p.share_pct)).toBeGreaterThan(33);

  // Gerente e diretor acompanham, mas não dividem VGV.
  const acompanhantes = (await participantesDe(negocio.id)).filter((p) => p.role !== "broker");
  for (const p of acompanhantes) expect(Number(p.share_pct)).toBe(0);
});

test("Status 2 escolhido na tabela grava em deals.status_detail e volta no reload", async ({ page }) => {
  const cliente = nomeCliente("Diego Status");
  const negocio = await semearNegocio({ cliente });
  // O rótulo é só um veículo para provar a gravação, e "13. ESTEIRA AGIL"
  // deixou de servir: pela decisão de 01/09 (migration 0037 + `SYSTEM_STATUSES`)
  // ele é escrito pelo BANCO quando o caso entra na esteira e recusado quando
  // escolhido à mão — some das opções do Select justamente para ninguém pintar
  // de verde um negócio que nunca foi conferido. Insistir nele aqui só voltaria
  // verde desligando essa proteção. A regra em si tem spec próprio
  // (`e2e/admin/esteira-label.spec.ts`); aqui basta um rótulo escolhível.
  const rotulo = "16. PENDENTE";

  await abrirPipeline(page);
  await buscar(page, cliente);
  await escolher(linhaDoNegocio(page, cliente).getByRole("combobox"), rotulo);

  await expect
    .poll(async () => (await negocioPorCliente(cliente)).status_detail, {
      message: "Status 2 precisa chegar em deals.status_detail",
    })
    .toBe(rotulo);
  expect((await negocioPorCliente(cliente)).id).toBe(negocio.id);

  await abrirPipeline(page);
  await buscar(page, cliente);
  await expect(linhaDoNegocio(page, cliente).getByRole("combobox")).toContainText(rotulo);
});

test("filtro de mês reduz a tabela ao mês pedido", async ({ page }) => {
  const janeiro = nomeCliente("Elis Janeiro");
  const fevereiro = nomeCliente("Elis Fevereiro");
  await semearNegocio({ cliente: janeiro, monthBase: "2030-01-01" });
  await semearNegocio({ cliente: fevereiro, monthBase: "2030-02-01" });

  await abrirPipeline(page);
  // O botão passou a se chamar só "Filtrar" (o título do painel é que continua
  // "Filtrar negócio"), e o mês virou um `<Select>` alimentado pelos meses que
  // existem em `deals` — antes era campo de texto livre, onde dava para digitar
  // um mês que não existia e ficar olhando uma tabela vazia sem entender.
  await page.getByRole("button", { name: /^filtrar$/i }).click();
  const filtroDeMes = page.getByRole("combobox", { name: "Mês-base" });

  await escolher(filtroDeMes, "01/2030");
  await expect(linhaDoNegocio(page, janeiro)).toBeVisible();
  await expect(linhaDoNegocio(page, fevereiro)).toHaveCount(0);

  await escolher(filtroDeMes, "02/2030");
  await expect(linhaDoNegocio(page, fevereiro)).toBeVisible();
  await expect(linhaDoNegocio(page, janeiro)).toHaveCount(0);
});

test("filtro de Status 2 reduz a tabela ao rótulo pedido", async ({ page }) => {
  const esteira = nomeCliente("Fabio Esteira");
  const pendente = nomeCliente("Fabio Pendente");
  await semearNegocio({ cliente: esteira, statusDetail: "13. ESTEIRA AGIL" });
  await semearNegocio({ cliente: pendente, statusDetail: "16. PENDENTE" });

  await abrirPipeline(page);
  await page.getByRole("button", { name: /^filtrar$/i }).click();
  // Pelo nome acessível, não pelo texto atual: o gatilho passa a mostrar o
  // valor escolhido, então um locator baseado no texto deixa de casar logo
  // depois do clique.
  // `exact: true` não é preciosismo: cada linha da tabela tem o próprio Select
  // de Status 2, nomeado "Status 2 de <cliente>" (achado X03), e o casamento por
  // substring do `getByRole` acha os 15 de uma vez.
  await escolher(page.getByRole("combobox", { name: "Status 2", exact: true }), "13. ESTEIRA AGIL");

  await expect(linhaDoNegocio(page, esteira)).toBeVisible();
  await expect(linhaDoNegocio(page, pendente)).toHaveCount(0);
});

test("comentário manual do histórico grava em deal_history com kind='comment'", async ({ page }) => {
  const cliente = nomeCliente("Gabi Historico");
  const negocio = await semearNegocio({ cliente });
  const texto = `Cliente pediu retorno na segunda ${marca}`;

  await abrirPipeline(page);
  await buscar(page, cliente);
  const modal = await abrirDetalhe(page, cliente);

  // O painel de comentários virou bloco próprio na Tarefa H: o texto mudou e o
  // botão de enviar ganhou nome acessível, então o XPath de irmão saiu.
  const caixa = modal.getByPlaceholder(/escreva o próximo passo deste negócio/i);
  await caixa.fill(texto);
  await modal.getByRole("button", { name: /enviar comentário/i }).click();

  await expect(modal.getByText(texto)).toBeVisible();
  await expect(caixa).toHaveValue("");

  const historico = await db.select<{ kind: string; to_value: string; actor_id: string }>(
    `deal_history?deal_id=eq.${negocio.id}&kind=eq.comment&select=kind,to_value,actor_id`,
  );
  expect(historico).toHaveLength(1);
  expect(historico[0].to_value).toBe(texto);
  expect(historico[0].actor_id).toBe(await db.profileIdOf("admin"));
});
