/**
 * Módulo SDR IA — aba Conversas, na visão do papel `sdr`.
 *
 * Três defeitos da auditoria de 02/09 viraram teste aqui:
 *
 *   · a lista não dizia de QUAL lead era a conversa (só status, score e data),
 *     e o papel `sdr` sequer conseguia ler o lead: `leads.view_queue` não é
 *     dele. A policy `leads_select_sdr` (0064) abre exatamente os leads que já
 *     têm conversa de SDR — e este teste falha se ela sumir;
 *   · não havia como um humano assumir a conversa: o operador só assistia. Com
 *     `status = 'human'` o `whatsapp-inbound-webhook`, que só atende conversa
 *     'active', para de responder;
 *   · nenhum teste automatizado tocava a aba.
 */
import { test, expect, db, aguardarCarregamento, runTag } from "../support/fixtures";
import { mintSession } from "../support/session";
import { resolveTarget } from "../support/target";
import { userFor } from "../support/users";

const alvo = resolveTarget();

const tag = runTag();
const NOME_LEAD = `Cliente Conversa ${tag}`;
const TELEFONE = "11955550042";
const RESUMO = `Busca 2 quartos na zona sul ${tag}`;

let leadId: string;
let conversaId: string;
let nomeDoAgente: string;

const conversaNoBanco = async () =>
  (await db.select<{ id: string; status: string }>(
    `sdr_conversations?id=eq.${conversaId}&select=id,status`,
  ))[0];

test.beforeAll(async () => {
  const [lead] = await db.insert<{ id: string }>("leads", {
    full_name: NOME_LEAD,
    phone: TELEFONE,
    phone_raw: TELEFONE,
    status: "queued",
    funnel_stage: "new",
    utm_source: `e2e_${tag}`,
  });
  leadId = lead.id;
  const [agente] = await db.select<{ id: string; name: string }>(
    "sdr_agents?active=eq.true&select=id,name&limit=1",
  );
  nomeDoAgente = agente?.name ?? "";
  const [conversa] = await db.insert<{ id: string }>("sdr_conversations", {
    lead_id: leadId,
    agent_id: agente?.id ?? null,
    status: "active",
    score: 73,
    summary: RESUMO,
  });
  conversaId = conversa.id;
  // `agent_id` (migration 0082) é o que guarda QUEM respondeu cada turno:
  // `sdr_conversations.agent_id` é sobrescrito a cada handoff e mostra só o
  // último da cadeia. As duas linhas repetem as mesmas chaves — o PostgREST
  // recusa lote heterogêneo com PGRST102.
  await db.insert("sdr_messages", [
    { conversation_id: conversaId, author: "lead", body: `Oi, quero visitar ${tag}`, agent_id: null },
    { conversation_id: conversaId, author: "agent", body: "Claro! Qual sua faixa de renda?", agent_id: agente?.id ?? null },
  ]);
});

test.afterAll(async () => {
  // Conversa e mensagens caem por cascade junto com o lead.
  await db.remove(`leads?id=eq.${leadId}`);
});

const abrirConversas = async (page: import("@playwright/test").Page) => {
  await page.goto("/sdr");
  await aguardarCarregamento(page);
  await page.getByRole("tab", { name: /conversas/i }).click();
  return page.getByRole("tabpanel");
};

test("a lista identifica o lead da conversa e o filtro acha pelo nome", async ({ page }) => {
  const painel = await abrirConversas(page);

  const item = painel.getByRole("button").filter({ hasText: NOME_LEAD });
  await expect(item, "sem o nome do lead o operador não acha a conversa do cliente").toBeVisible();
  await expect(item).toContainText("73");

  // Filtro: some quem não casa, fica quem casa.
  await painel.getByLabel(/buscar por nome ou telefone/i).fill(NOME_LEAD);
  await expect(painel.getByRole("button").filter({ hasText: NOME_LEAD })).toBeVisible();

  await painel.getByLabel(/buscar por nome ou telefone/i).fill("zzz-nada-com-esse-nome");
  await expect(painel.getByText(/nenhuma conversa com esse filtro/i)).toBeVisible();
});

test("abrir a conversa mostra o resumo, o score e as mensagens", async ({ page }) => {
  const painel = await abrirConversas(page);
  await painel.getByRole("button").filter({ hasText: NOME_LEAD }).click();

  await expect(painel.getByText(RESUMO)).toBeVisible();
  await expect(painel.getByText(/score 73/i)).toBeVisible();
  await expect(painel.getByText("Claro! Qual sua faixa de renda?")).toBeVisible();

  // A cadeia sai das MENSAGENS, não da conversa: é o único lugar onde a
  // passagem por um agente anterior sobrevive ao próximo handoff.
  expect(nomeDoAgente, "cenário precisa de um agente ativo com nome").toBeTruthy();
  await expect(painel.getByText(new RegExp(`Passou por:.*${nomeDoAgente}`))).toBeVisible();
});

test("assumir a conversa tira o robô e devolver traz de volta", async ({ page }) => {
  const painel = await abrirConversas(page);
  await painel.getByRole("button").filter({ hasText: NOME_LEAD }).click();

  await painel.getByRole("button", { name: /assumir conversa/i }).click();
  await expect(page.getByText(/você assumiu a conversa/i)).toBeVisible();
  // O que faz o robô calar é o status: o whatsapp-inbound-webhook só atende
  // conversa 'active'. Toast sem linha gravada seria a tela mentindo.
  await expect(async () => {
    expect((await conversaNoBanco()).status).toBe("human");
  }).toPass({ timeout: 10_000 });
  await expect(painel.getByText(/o robô parou de responder/i)).toBeVisible();

  await painel.getByRole("button", { name: /devolver ao robô/i }).click();
  await expect(page.getByText(/devolvida ao robô/i)).toBeVisible();
  await expect(async () => {
    expect((await conversaNoBanco()).status).toBe("active");
  }).toPass({ timeout: 10_000 });
});

/**
 * Responder de dentro do CRM (decisão de 02/09: o operador continua a conversa
 * aqui, não "pelo aparelho").
 *
 * A caixa de resposta só existe quando a conversa está com o humano — enquanto
 * o robô atende, duas vozes escreveriam para o mesmo cliente.
 */
test("a caixa de resposta só aparece depois de assumir a conversa", async ({ page }) => {
  const painel = await abrirConversas(page);
  await painel.getByRole("button").filter({ hasText: NOME_LEAD }).click();

  const caixa = painel.getByLabel(/sua resposta ao lead/i);
  await expect(caixa, "conversa com o robô não pode oferecer caixa de resposta").toHaveCount(0);

  await painel.getByRole("button", { name: /assumir conversa/i }).click();
  await expect(caixa).toBeVisible();
  // Botão desabilitado com o campo vazio: enviar em branco viraria um 400 que
  // o operador leria como "o WhatsApp está fora do ar".
  await expect(painel.getByRole("button", { name: /enviar pelo whatsapp/i })).toBeDisabled();

  await painel.getByRole("button", { name: /devolver ao robô/i }).click();
  await expect(caixa).toHaveCount(0);
});

/**
 * O contrato da function, sem navegador: responder numa conversa que ainda é do
 * robô é RECUSADO — e a recusa acontece antes de tocar no cofre e na Graph API,
 * então vale no ambiente sem credencial da Meta (que é o de hoje).
 *
 * Sem esta trava, "Devolver ao robô" numa aba e "Enviar" em outra fariam a
 * empresa mandar duas respostas para o mesmo cliente.
 */
test("a function recusa resposta humana enquanto a conversa é do robô", async () => {
  const { access_token } = await mintSession(userFor("sdr").email);
  const antes = await db.select<{ id: string }>(
    `sdr_messages?conversation_id=eq.${conversaId}&select=id`,
  );

  const res = await fetch(`${alvo.supabaseUrl}/functions/v1/sdr-whatsapp-broadcast`, {
    method: "POST",
    headers: {
      apikey: alvo.anonKey,
      Authorization: `Bearer ${access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "human_reply",
      conversation_id: conversaId,
      text: `tentativa de resposta com o robô ativo ${tag}`,
    }),
  });

  expect(res.status, "responder por cima do robô tem de ser recusado").toBe(409);
  expect((await res.json()).code).toBe("conversation_not_human");

  // A recusa é real: nada foi gravado no histórico.
  const depois = await db.select<{ id: string }>(
    `sdr_messages?conversation_id=eq.${conversaId}&select=id`,
  );
  expect(depois.length, "a recusa não pode deixar mensagem gravada").toBe(antes.length);
});

/**
 * A data da linha é a da ÚLTIMA MENSAGEM, não a de qualquer gravação.
 *
 * O selo "parada há X" passou a contar de `last_message_at` (trigger
 * `sdr_messages_touch`), mas a data ao lado ainda vinha de `updated_at` — e a
 * ordenação também. Assumir a conversa grava `status` e move `updated_at`: a
 * conversa subia para o topo exibindo a hora de AGORA colada no selo "parada há
 * 5 dias", duas afirmações contraditórias na mesma linha, e a lista passava a
 * premiar justamente a conversa que ninguém respondeu.
 */
test("a data da linha acompanha o selo de parada, mesmo depois de assumir", async ({ page }) => {
  const antiga = new Date(Date.now() - 5 * 24 * 3_600_000);
  const carimbo = `${String(antiga.getDate()).padStart(2, "0")}/${String(antiga.getMonth() + 1).padStart(2, "0")}/${antiga.getFullYear()}`;
  // A coluna é mantida por trigger; aqui ela é posicionada no passado para o
  // caso não depender de esperar 6 h de relógio real.
  await db.update(`sdr_conversations?id=eq.${conversaId}`, {
    status: "active",
    last_message_at: antiga.toISOString(),
  });

  const painel = await abrirConversas(page);
  const linha = painel.getByRole("button").filter({ hasText: NOME_LEAD });
  await expect(linha).toContainText(carimbo);
  await expect(linha).toContainText(/parada há 5 dias/i);

  await linha.click();
  await painel.getByRole("button", { name: /assumir conversa/i }).click();
  await expect(page.getByText(/você assumiu a conversa/i)).toBeVisible();

  // A lista é relida depois de gravar: a data não pode virar "agora".
  await expect(
    linha,
    "gravar o status não pode reescrever a data da última mensagem",
  ).toContainText(carimbo);
  await expect(linha).toContainText(/parada há 5 dias/i);
  // E a seleção sobrevive à releitura — sem ela some o botão de devolver ao
  // robô e a caixa de resposta, com as mensagens ainda na tela.
  await expect(painel.getByRole("button", { name: /devolver ao robô/i })).toBeVisible();
});
