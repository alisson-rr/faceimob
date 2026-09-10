/**
 * Webhook de mensagens da WhatsApp Cloud API — o contrato da URL pública.
 *
 * É a function com mais lógica do fluxo de SDR (parse do payload da Meta,
 * casamento do telefone com o lead, criação de lead a partir de contato de
 * remarketing, handoff) e NENHUM teste automatizado a tocava. O que dá para
 * provar sem as credenciais do Douglas é justamente o que mais importa:
 * enquanto elas não existirem, a URL não pode ser um jeito de qualquer um
 * injetar conversa, criar lead e queimar crédito de OpenAI.
 *
 * O que este arquivo defende:
 *   · POST sem assinatura válida é RECUSADO — no estado atual porque
 *     `meta/app_secret` não está no cofre (401 com o motivo em JSON), e depois
 *     de cadastrado porque a assinatura não confere (401 "Invalid signature").
 *     Os dois desfechos são 401 de propósito: a URL é pública;
 *   · a recusa é de verdade, não cosmética — nenhuma conversa, mensagem ou
 *     lead nasce do POST recusado;
 *   · o handshake GET só ecoa o desafio com o verify token certo; com token
 *     errado é 403, nunca 200;
 *   · método fora de GET/POST é 405, e não um 500 que a Meta reentregaria.
 *
 * Nada aqui grava cenário: o teste só prova que a porta está fechada.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect, db, runTag } from "../support/fixtures";
import { resolveTarget } from "../support/target";

const alvo = resolveTarget();
const tag = runTag();
const URL_INBOUND = `${alvo.supabaseUrl}/functions/v1/whatsapp-inbound-webhook`;

/** Telefone que não existe no banco: se o webhook processasse o payload, ele
 *  criaria (ou tentaria criar) rastro com este número, e é isso que checamos. */
const TELEFONE_INVASOR = "5551900000042";

/** Payload no formato da Meta, com o campo `messages` que a function lê. */
const payloadDaMeta = (texto: string) => ({
  object: "whatsapp_business_account",
  entry: [{
    id: "0",
    changes: [{
      field: "messages",
      value: {
        messaging_product: "whatsapp",
        messages: [{
          from: TELEFONE_INVASOR,
          id: `wamid.e2e.${tag}`,
          type: "text",
          text: { body: texto },
        }],
      },
    }],
  }],
});

const postar = (corpo: unknown, headers: Record<string, string> = {}) =>
  fetch(URL_INBOUND, {
    method: "POST",
    headers: { apikey: alvo.anonKey, "Content-Type": "application/json", ...headers },
    body: JSON.stringify(corpo),
  });

test("POST sem assinatura da Meta é recusado com 401", async () => {
  const res = await postar(payloadDaMeta(`quero um apartamento ${tag}`));

  // 401 nos DOIS estados possíveis do cofre. Aceitar quando o app secret falta
  // era o buraco: quem descobrisse a URL injetava conversa de SDR e gastava
  // token da OpenAI, com uma linha de log como único sinal.
  expect(res.status, "URL pública sem prova de origem tem de recusar").toBe(401);

  const corpo = await res.text();
  // Sem credencial, a function diz o que cadastrar em vez de só "não". Com ela
  // cadastrada, a resposta é "Invalid signature" — as duas são recusas honestas.
  expect(
    /app_secret|Invalid signature/i.test(corpo),
    `a recusa precisa dizer o motivo; veio: ${corpo.slice(0, 200)}`,
  ).toBe(true);
});

test("o POST recusado não deixa lead, conversa nem mensagem para trás", async () => {
  await postar(payloadDaMeta(`mensagem que não pode entrar ${tag}`));

  // A prova de que a recusa é real: o efeito colateral que o caminho feliz
  // teria (lead novo pelo telefone, conversa aberta, mensagem gravada) não
  // existe em lugar nenhum.
  const leads = await db.select<{ id: string }>(
    `leads?phone_raw=eq.${TELEFONE_INVASOR}&select=id`,
  );
  expect(leads, "POST sem assinatura criou lead").toHaveLength(0);

  const mensagens = await db.select<{ id: string }>(
    `sdr_messages?provider_message_id=eq.wamid.e2e.${tag}&select=id`,
  );
  expect(mensagens, "POST sem assinatura gravou turno de conversa").toHaveLength(0);
});

test("payload vazio também é recusado antes de qualquer processamento", async () => {
  // Corpo sem `entry` não tem nada para processar, mas a ordem importa: a
  // assinatura é conferida ANTES do parse. Se este caso virasse 200, seria
  // sinal de que a verificação passou a rodar depois — e a porta teria caído.
  const res = await postar({});
  expect(res.status).toBe(401);
});

test("handshake GET recusa token de verificação errado com 403", async () => {
  const desafio = `desafio-${tag}`;
  const res = await fetch(
    `${URL_INBOUND}?hub.mode=subscribe&hub.verify_token=token-errado-${tag}&hub.challenge=${desafio}`,
    { headers: { apikey: alvo.anonKey } },
  );

  expect(res.status, "token errado não pode assinar o webhook").toBe(403);
  expect(
    (await res.text()).includes(desafio),
    "ecoar o desafio com token errado deixaria a Meta assinar a URL",
  ).toBe(false);
});

test("método fora de GET/POST é 405 — e não um 500 que a Meta reentregaria", async () => {
  const res = await fetch(URL_INBOUND, { method: "PUT", headers: { apikey: alvo.anonKey } });
  expect(res.status).toBe(405);
});

/**
 * Coluna que só existe depois da migration: o insert tem de tolerar.
 *
 * `sdr_messages.agent_id` nasce na 0082, e function e migration sobem por
 * caminhos diferentes. Com a chave num insert cru, um deploy que chegue antes
 * da migration derruba o turno inteiro com PGRST204 — e derruba DEPOIS da
 * chamada à OpenAI: o turno é cobrado, o lead fica sem resposta e, como nada
 * foi gravado, a checagem de idempotência não vê a mensagem e o replay da Meta
 * reprocessa e cobra de novo. Na `sdr-whatsapp-broadcast` o efeito é o gêmeo:
 * a Meta já entregou a mensagem ao cliente quando o insert falha, o trigger
 * `sdr_messages_touch` não roda e o selo "parada há X h" fica na lista logo
 * depois de o operador ter respondido.
 *
 * Este teste é de fonte, e não de banco, porque a falha só aparece na janela
 * entre o deploy e a migration — janela que o teste de integração não alcança.
 */
test("o insert em sdr_messages não depende da coluna da 0082", () => {
  const shared = readFileSync(resolve("supabase/functions/_shared/sdrAgent.ts"), "utf8");
  // Quem grava a autoria do turno passa pelo helper que repete sem a chave.
  expect(shared, "o turno do agente voltou a gravar sem tolerância").toMatch(/async function insertMessages/);
  expect(shared, "a retentativa sem agent_id sumiu").toMatch(/PGRST204/);
  expect(
    /from\("sdr_messages"\)\s*\.insert\(\[/.test(shared),
    "lote cru em sdr_messages fora do helper: use insertMessages()",
  ).toBe(false);

  // As functions que gravam direto não mandam a coluna nova — nem com `null`,
  // que não grava nada e cria a dependência de graça.
  for (const arquivo of [
    "supabase/functions/sdr-whatsapp-broadcast/index.ts",
    "supabase/functions/meta-ads-webhook/index.ts",
  ]) {
    const fonte = readFileSync(resolve(arquivo), "utf8");
    const payload = /from\(['"]sdr_messages['"]\)\.insert\(\{([\s\S]*?)\n\s*\}\)/.exec(fonte)?.[1];
    expect(payload, `${arquivo}: o insert mudou de forma — ajuste este teste junto`).toBeDefined();
    expect(payload, `${arquivo}: chave que só existe depois da 0082 num insert que roda antes dela`)
      .not.toContain("agent_id");
  }
});
