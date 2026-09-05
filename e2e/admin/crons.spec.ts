/**
 * Admin > Integrações > Saúde dos jobs.
 *
 * Por que este arquivo existe: `faceimob-notify-dispatch` ficou PAUSADO de
 * 05/08 a 03/09 com a fila de WhatsApp crescendo, e nada reprovou — o
 * 04_cron_scheduling.sql afirma três jobs e a aba nunca teve cobertura de tela.
 * Um agendamento some (ou é pausado por engano no console do banco) e o único
 * lugar onde isso apareceria é aqui.
 *
 * O teste NÃO fixa a lista de jobs nem quais estão ativos: ele lê o banco pela
 * mesma `cron_jobs_health()` da tela e cobra que a tela diga exatamente aquilo.
 * Fixar "notify-dispatch está ativo" transformaria este arquivo num teste da
 * migration 0065 — e ele reprovaria em qualquer ambiente onde ela ainda não
 * tivesse sido aplicada, que é ruído, não defeito.
 *
 * O que ele fixa é o conjunto mínimo de jobs SEM O QUAL a operação para: sem
 * eles a trava de 5 minutos não libera o lead, a fila de leads sem corretor não
 * é reprocessada e nenhum dossiê sai para a construtora.
 *
 * O que ele NÃO consegue afirmar: o texto do estado vazio da aba, que só aparece
 * com a lista vazia — e lista vazia aqui é falha fatal (o primeiro teste reprova
 * antes). Ele prometia "três linhas `faceimob-*`" enquanto o agendador tinha
 * dez, e quem abrisse a aba num ambiente que perdeu jobs compararia contra o
 * número errado; o texto deixou de citar contagem (02/09/2026), que é a única
 * correção que não envelhece a cada job novo.
 */
import { test, expect, aguardarCarregamento } from "../support/fixtures";
import { resolveTarget } from "../support/target";
import { mintSession } from "../support/session";
import { E2E_USERS } from "../support/users";

type SaudeDoJob = {
  job_name: string;
  schedule: string;
  active: boolean;
  failures_24h: number;
  runs_24h: number;
};

/** Sem estes o sistema para de funcionar sozinho, e o sintoma aparece longe da causa. */
const JOBS_ESSENCIAIS = [
  "faceimob-release-expired-leads",
  "faceimob-auto-checkout-expired",
  "faceimob-assign-queued",
  "faceimob-submission-dispatch",
  "faceimob-notify-dispatch",
];

/**
 * `cron_jobs_health()` é SECURITY DEFINER com `public.is_admin()` no WHERE: a
 * service_role não tem `auth.uid()` e receberia lista vazia — indistinguível de
 * "não há job". Vai com o JWT do admin, o mesmo que a tela usa.
 */
async function saudeComoAdmin(): Promise<SaudeDoJob[]> {
  const t = resolveTarget();
  const { access_token } = await mintSession(E2E_USERS.find((u) => u.key === "admin")!.email);
  const res = await fetch(`${t.supabaseUrl}/rest/v1/rpc/cron_jobs_health`, {
    method: "POST",
    headers: { apikey: t.anonKey, Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(`cron_jobs_health → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function abrirAbaDeJobs(page: import("@playwright/test").Page) {
  await page.goto("/admin/integrations");
  await aguardarCarregamento(page);
  await page.getByRole("tab", { name: "Saúde dos jobs" }).click();
}

/**
 * As linhas da tabela DOS JOBS.
 *
 * A aba tem duas tabelas — esta e a da fila de notificações por canal — e um
 * `tbody tr` solto somava as duas: dez jobs mais dois canais pendentes davam
 * doze linhas onde o banco tem dez. Amarrar pelo nome acessível é o que o
 * `<caption>` da tela passou a permitir; antes as duas se anunciavam como
 * "tabela" e não havia como se referir a uma delas — nem daqui, nem no leitor
 * de tela.
 */
const linhasDeJobs = (page: import("@playwright/test").Page) =>
  page.getByRole("table", { name: "Jobs agendados no banco" }).locator("tbody tr");

test("a aba de jobs mostra o que o banco tem, linha por linha", async ({ page }) => {
  const jobs = await saudeComoAdmin();
  // Lista vazia aqui significaria que o admin E2E perdeu o papel — não que a
  // operação não tem cron. Falhar cedo evita um teste que "passa" sem afirmar nada.
  expect(jobs.length, "cron_jobs_health() não devolveu job nenhum para o admin").toBeGreaterThan(0);

  await abrirAbaDeJobs(page);

  // Com jobs no banco, o estado vazio não pode aparecer.
  await expect(page.getByText(/Nenhum job visível/)).toHaveCount(0);

  for (const job of jobs) {
    const linha = linhasDeJobs(page).filter({ hasText: job.job_name });
    await expect(linha, `o job ${job.job_name} não aparece na tela`).toHaveCount(1);

    const celulas = linha.locator("td");
    await expect(celulas.nth(1), `cadência errada em ${job.job_name}`).toHaveText(job.schedule);
    // Um job pausado precisa aparecer como pausado: foi o estado que passou um
    // mês invisível.
    await expect(celulas.nth(2), `estado ativo/pausado errado em ${job.job_name}`)
      .toHaveText(job.active ? "sim" : "não");
    await expect(celulas.nth(4), `contagem de falhas errada em ${job.job_name}`)
      .toHaveText(String(job.failures_24h));
    // `runs_24h` é janela deslizante: no remoto, `release-expired-leads` roda a
    // cada 30 s e o número muda entre a leitura do banco e a da tela. Fixar o
    // valor exato reprovaria por relógio, não por defeito. O que precisa ser
    // provado é que a coluna traz um número do banco, não um traço ou um
    // placeholder — `failures_24h` acima continua no valor exato porque é 0 e
    // estável, e é dele que depende o alerta.
    await expect(celulas.nth(5), `contagem de execuções ausente em ${job.job_name}`)
      .toHaveText(/^\d+$/);
  }

  // Nenhuma linha inventada: a tela não mostra job que o banco não tem.
  await expect(linhasDeJobs(page)).toHaveCount(jobs.length);
});

test("os jobs sem os quais a operação para continuam agendados", async ({ page }) => {
  const jobs = await saudeComoAdmin();
  const agendados = jobs.map((j) => j.job_name);

  for (const nome of JOBS_ESSENCIAIS) {
    expect(agendados, `o job ${nome} sumiu do agendador`).toContain(nome);
  }

  await abrirAbaDeJobs(page);
  for (const nome of JOBS_ESSENCIAIS) {
    await expect(linhasDeJobs(page).filter({ hasText: nome })).toHaveCount(1);
  }

  // Falha registrada não pode passar despercebida: se algum job falhou nas
  // últimas 24 h, a tela tem de mostrar o número — e o teste, reprovar, para
  // que alguém olhe.
  const comFalha = jobs.filter((j) => j.failures_24h > 0);
  expect(
    comFalha.map((j) => `${j.job_name}: ${j.failures_24h} falha(s) em 24 h`),
    "há job de cron falhando no ambiente",
  ).toEqual([]);
});

test("a tabela de jobs cabe no celular sem empurrar a página", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 720 });
  await abrirAbaDeJobs(page);

  await expect(page.getByRole("tab", { name: "Saúde dos jobs" })).toBeVisible();

  // A tabela é larga de propósito (6 colunas); quem rola é o contêiner dela.
  // Se o transbordo vazar para o body, toda a tela do admin anda para o lado.
  const transbordo = await page.evaluate(() => {
    const el = document.documentElement;
    return el.scrollWidth - el.clientWidth;
  });
  expect(transbordo, "a página inteira rola na horizontal a 375 px").toBeLessThanOrEqual(1);
});

/**
 * O cron verde não prova entrega.
 *
 * `faceimob-notify-dispatch` ficou PAUSADO por um mês e, depois de reativado,
 * seguiu verde por outro motivo: ele roda todo minuto e devolve 503 por falta
 * de credencial, enquanto a fila cresce atrás. Em 03/09 eram 312 mensagens
 * `whatsapp` esperando, 268 criadas no mesmo dia, +30 em 12 minutos de
 * auditoria. Nenhum teste olhava o tamanho nem a idade da fila.
 *
 * A leitura vem de `notification_queue_health()` (migration 0082), a mesma que
 * a aba de Integrações consome — testar pela RPC da tela evita inventar um
 * segundo caminho para a mesma pergunta.
 */
type FilaDoCanal = {
  channel: string;
  pendentes: number;
  com_erro: number;
  mais_antiga: string | null;
  ultimo_erro: string | null;
  max_tentativas: number;
};

async function filaComoAdmin(): Promise<FilaDoCanal[]> {
  const t = resolveTarget();
  const { access_token } = await mintSession(E2E_USERS.find((u) => u.key === "admin")!.email);
  const res = await fetch(`${t.supabaseUrl}/rest/v1/rpc/notification_queue_health`, {
    method: "POST",
    headers: { apikey: t.anonKey, Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(`notification_queue_health → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

test("os jobs sem os quais a operação para estão ATIVOS, não só agendados", async () => {
  const jobs = await saudeComoAdmin();

  // Agendado e pausado é o estado que passou um mês invisível: o job aparece na
  // lista, o teste de existência passa, e nada roda.
  const pausados = jobs
    .filter((j) => JOBS_ESSENCIAIS.includes(j.job_name) && !j.active)
    .map((j) => j.job_name);

  expect(pausados, "job essencial agendado porém pausado").toEqual([]);
});

test("a fila de saída de WhatsApp não guarda aviso vencido", async () => {
  const fila = await filaComoAdmin();
  const whatsapp = fila.find((f) => f.channel === "whatsapp");

  // Fila vazia é o estado bom: nada a cobrar.
  if (!whatsapp || whatsapp.pendentes === 0 || !whatsapp.mais_antiga) return;

  // O corte é de 2 h (`expire_stale_outbound_notifications`, migration 0083) e
  // quem o aplica é o gatilho do cron, a cada minuto. A folga de 1 h absorve o
  // intervalo entre a criação da mensagem e a próxima passada do job — não uma
  // fila que voltou a crescer sem teto.
  const horas = (Date.now() - new Date(whatsapp.mais_antiga).getTime()) / 3_600_000;
  expect(
    horas,
    `a mensagem mais antiga da fila tem ${horas.toFixed(1)} h; o corte de idade não está rodando ` +
      `(${whatsapp.pendentes} pendentes, último motivo: ${whatsapp.ultimo_erro ?? "nenhum"})`,
  ).toBeLessThan(3);

  // Mensagem parada sem motivo escrito é mensagem que ninguém consegue
  // diagnosticar: 53 de 312 tinham `last_error` porque o worker só marcava as
  // 50 mais antigas, e repescava sempre as mesmas.
  //
  // A cobrança é condicionada à IDADE, como o assert acima, e não ao simples
  // fato de haver pendente: `notification_queue_health()` agrega só linhas com
  // `sent_at is null` e devolve o último `last_error` NÃO NULO do grupo. No
  // estado SAUDÁVEL sobra a janela entre o gatilho que criou a linha e a
  // próxima passada do cron (até 60 s) — uma linha nova, `attempts = 0`,
  // `last_error = null` — e exigir motivo ali reprovaria por relógio. Hoje o
  // assert passa por acidente, porque com 711 linhas represadas sempre há
  // alguma com erro; ele ficaria mais frágil quanto mais saudável o sistema.
  // Passada uma passada do cron com folga, aí sim: sem motivo escrito ninguém
  // diagnostica.
  if (horas * 60 > 2) {
    expect(
      whatsapp.ultimo_erro,
      `a mensagem mais antiga tem ${(horas * 60).toFixed(0)} min na fila e nenhuma delas ` +
        "registra por que não saiu",
    ).not.toBeNull();
  }

  // O teto de tentativas (`MAX_ATTEMPTS = 5` em notify-dispatch) é o que impede
  // um telefone inválido de ser reprocessado para sempre. Passar de 5 significa
  // que o worker parou de contar — e a fila voltou a ser um laço infinito.
  expect(
    whatsapp.max_tentativas,
    `há mensagem com ${whatsapp.max_tentativas} tentativas; o teto do worker é 5`,
  ).toBeLessThanOrEqual(5);
});

/**
 * As duas portas do `submission-dispatch`.
 *
 * A function tem dois chamadores e cada um entra por uma porta diferente: o
 * pg_cron com a chave de serviço (fila de dossiês) e o admin com o próprio JWT
 * (`action: 'probe'`, o "Testar conexão" do Brevo). A segunda porta manda dossiê
 * de cliente por e-mail se estiver aberta — daí o teste começar por ela.
 */
async function sondarBrevo(chave: "admin" | "broker") {
  const t = resolveTarget();
  const { access_token } = await mintSession(E2E_USERS.find((u) => u.key === chave)!.email);
  const res = await fetch(`${t.supabaseUrl}/functions/v1/submission-dispatch`, {
    method: "POST",
    headers: {
      apikey: t.anonKey,
      Authorization: `Bearer ${access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "probe" }),
  });
  const corpo = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
  return { status: res.status, corpo };
}

test("só quem administra integrações testa a conexão do Brevo", async () => {
  const semPermissao = await sondarBrevo("broker");
  expect(
    semPermissao.status,
    "o corretor entrou pela porta de teste de credencial do submission-dispatch",
  ).toBe(403);

  const comPermissao = await sondarBrevo("admin");
  expect(comPermissao.status, "o admin foi recusado na porta que a tela dele usa")
    .not.toBe(403);
  expect(comPermissao.status, "a sonda quebrou por dentro em vez de responder").not.toBe(500);
  // Resposta honesta: ou funciona, ou diz em português o que consertar.
  expect(typeof comPermissao.corpo.ok, "a sonda não devolveu um veredito").toBe("boolean");
  if (comPermissao.corpo.ok === false) {
    expect(comPermissao.corpo.error?.length ?? 0, "recusa sem motivo escrito")
      .toBeGreaterThan(10);
  }
});

/**
 * Meia credencial é pior do que nenhuma.
 *
 * Em 02/09/2026 `brevo/sender_email` no cofre da homologação guardava a CHAVE DE
 * API da própria Brevo (89 caracteres, começa com `xkeysib`, sem arroba). A tela
 * de Integrações mostrava "no cofre", nada contradizia, e todo envio de dossiê
 * morreria na Brevo com remetente inválido. Nenhum teste olhava para isso porque
 * o único jeito de olhar é perguntar ao provedor.
 *
 * Ambiente sem Brevo nenhum (o alvo local) não é defeito: é ausência, e o teste
 * se retira. O que ele cobra é a metade configurada.
 */
test("a credencial do Brevo, quando cadastrada, é utilizável de verdade", async () => {
  const { corpo } = await sondarBrevo("admin");

  // O predicado tem de casar a AUSÊNCIA e só ela. `/api_key/` casava as DUAS
  // respostas de `probeBrevo` que citam o slot: "Falta a chave brevo/api_key no
  // cofre" (ausência, legítimo pular) e "A Brevo recusou a chave de API"
  // (chave gravada e inválida — exatamente a meia credencial que este teste
  // existe para pegar). A segunda fazia o teste ficar VERDE por skip.
  test.skip(
    corpo.ok === false && /Falta a chave brevo\/api_key/.test(corpo.error ?? ""),
    "Brevo não configurado neste ambiente (falta brevo/api_key) — nada a cobrar",
  );

  expect(
    corpo.ok,
    `a chave do Brevo existe mas a integração não está utilizável: ${corpo.error ?? "sem motivo"}`,
  ).toBe(true);
});

/**
 * O check-in devolve o CÓDIGO da recusa, não só a frase.
 *
 * `perform_checkin` distingue os motivos por errcode e `broker-checkin` repassa
 * `code` junto da frase. Enquanto a function devolvia só `message`, a tela
 * precisava adivinhar o motivo pelo texto em português: uma correção de redação
 * numa migration mudava o comportamento do cliente em silêncio.
 *
 * **O código não é fixado em `42501` aqui, e a razão foi medida (02/09/2026).**
 * O gatilho `handle_new_auth_user` (0002) grava `broker` para TODA conta nova —
 * "todo mundo entra como corretor" — e `provisionE2EUsers()` só ACRESCENTA os
 * papéis declarados, sem tirar esse. O "CCA" da suíte é, no banco, {cca,
 * broker}; `broker` TEM `menu.checkin` (`role_permissions`), então a chamada
 * passa pela trava de permissão e a recusa que chega é a seguinte da fila
 * (`P0001`, IP fora das faixas de `allowed_ips`). Exigir `42501` era cobrar do
 * produto um estado que o fixture não monta — e a recusa por permissão continua
 * coberta, com o papel extra removido durante a asserção, em
 * `e2e/admin/permissoes.spec.ts` → "o menu de Check-in é trava de banco". O
 * conserto da raiz é `provisionE2EUsers()` deixar exatamente os papéis
 * declarados, e o arquivo é de outra frente.
 *
 * O que sobra é o que só este teste vê:
 *  - o CCA NÃO entra na fila da roleta pela edge function — a recusa acontece;
 *  - a recusa chega com o SQLSTATE do banco, não só com a frase;
 *  - o IP do chamador é identificado. Se falhar com "Não foi possível
 *    identificar seu IP", a escolha de header do gateway mudou e TODO check-in
 *    da operação está sendo negado.
 */
test("o check-in recusado devolve o código do banco, não só o texto", async () => {
  const t = resolveTarget();
  const { access_token } = await mintSession(E2E_USERS.find((u) => u.key === "cca")!.email);

  const res = await fetch(`${t.supabaseUrl}/functions/v1/broker-checkin`, {
    method: "POST",
    headers: {
      apikey: t.anonKey,
      Authorization: `Bearer ${access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "checkin" }),
  });
  const corpo = await res.json().catch(() => ({})) as { error?: string; code?: string | null };

  expect(
    res.status,
    "o CCA entrou na fila da roleta pela edge function — confira se o perfil dele " +
      "carrega o papel `broker` que o gatilho concede a toda conta nova",
  ).toBe(400);
  expect(
    corpo.error ?? "",
    "o gateway parou de entregar o IP do chamador: TODO check-in da operação está sendo negado",
  ).not.toMatch(/identificar seu IP/i);
  // SQLSTATE tem cinco caracteres (42501 sem permissão, P0001 regra de operação,
  // 28000 sessão perdida): é por ele que a tela decide, não pela frase.
  expect(
    corpo.code ?? "",
    `recusa sem o errcode do banco — a tela volta a adivinhar pelo texto: "${corpo.error ?? ""}"`,
  ).toMatch(/^[0-9A-Z]{5}$/);
  expect(corpo.error?.length ?? 0, "recusa sem frase em pt-BR para a tela mostrar")
    .toBeGreaterThan(10);
});

/**
 * A borda das integrações que esperam credencial de terceiro.
 *
 * Três endpoints do sistema existem para receber chamada de fora e nenhum deles
 * jamais processou um evento, porque a credencial nunca chegou. Isso deixa uma
 * pergunta sem resposta que só um teste responde: **eles falham fechados?**
 *
 * Um webhook sem credencial pode falhar de três jeitos, e dois são desastre:
 * aceitar sem prova de origem (foi o estado do `whatsapp-inbound-webhook` até
 * 02/09 — quem descobrisse a URL injetava conversa de SDR e gastava token da
 * OpenAI) ou responder 500, que faz a plataforma do fornecedor retentar para
 * sempre. O certo é recusar com um código que diga o motivo: 401/403 para
 * "não provou quem é", 503 para "ainda não fui configurado".
 *
 * O teste NÃO fixa QUAL dos dois: cadastrar a credencial muda 503 em 401 sem
 * mudar nada de errado. O que ele fixa é que **nenhum deles responde 2xx** e que
 * nenhum responde 500. Vale antes e depois de as credenciais chegarem, que é a
 * única forma de o teste continuar dizendo algo no dia seguinte.
 */
const BORDAS = [
  {
    nome: "voice-ai-webhook",
    // 503 sem `voice_ai/webhook_secret`; 401 depois que ele existir.
    metodo: "POST" as const,
    corpo: JSON.stringify({ external_id: "e2e-sonda", type: "lead_qualified" }),
    autorizacao: "Bearer segredo-invalido-de-teste",
  },
  {
    nome: "whatsapp-inbound-webhook",
    // 401 sem `meta/app_secret`; 401 também com ele, por assinatura inválida.
    metodo: "POST" as const,
    corpo: JSON.stringify({ entry: [] }),
    autorizacao: null,
  },
  {
    nome: "notify-dispatch",
    // Worker de fila: só a service role entra. Com a chave publicável — a que
    // vai no bundle do navegador — tem de bater em 401 (achado S04).
    metodo: "POST" as const,
    corpo: "{}",
    autorizacao: "publicavel",
  },
];

test("os endpoints que esperam credencial de terceiro falham fechados", async () => {
  const t = resolveTarget();

  for (const borda of BORDAS) {
    const auth = borda.autorizacao === "publicavel"
      ? `Bearer ${t.anonKey}`
      : borda.autorizacao;

    const res = await fetch(`${t.supabaseUrl}/functions/v1/${borda.nome}`, {
      method: borda.metodo,
      headers: {
        apikey: t.anonKey,
        "Content-Type": "application/json",
        ...(auth ? { Authorization: auth } : {}),
      },
      body: borda.corpo,
    });

    expect(res.status, `${borda.nome} ACEITOU uma chamada sem credencial válida`)
      .not.toBe(200);
    // 500 faz a plataforma do fornecedor retentar para sempre: o contrato
    // publicado em docs/integracoes/ promete 503 para "falta configuração".
    expect(res.status, `${borda.nome} respondeu 500 — o fornecedor vai retentar para sempre`)
      .not.toBe(500);
    expect(
      [401, 403, 503],
      `${borda.nome} respondeu ${res.status}, que não é nenhuma das recusas previstas`,
    ).toContain(res.status);
  }
});

test("o handshake do webhook de WhatsApp recusa token errado", async () => {
  const t = resolveTarget();

  // É o GET que a Meta faz ao registrar o webhook no painel. Responder o
  // `hub.challenge` para qualquer token deixaria qualquer um assinar os eventos.
  const res = await fetch(
    `${t.supabaseUrl}/functions/v1/whatsapp-inbound-webhook` +
      "?hub.mode=subscribe&hub.verify_token=token-errado-de-teste&hub.challenge=12345",
    { headers: { apikey: t.anonKey } },
  );

  expect(res.status, "o handshake devolveu o challenge para um token errado").toBe(403);
  expect(await res.text()).not.toContain("12345");
});
