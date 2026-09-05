/**
 * `notify-dispatch` — o worker que entrega as notificações de WhatsApp.
 *
 * É ele que cumpre o requisito 10 da ata ("avisar o corretor que perdeu o lead
 * por prazo"): os gatilhos gravam em `notifications` com `channel='whatsapp'` e
 * este worker drena a fila a cada minuto pelo pg_cron. Não tinha NENHUM teste
 * automatizado — e é a única function do módulo que manda mensagem para o
 * telefone de gente da equipe.
 *
 * O que este arquivo defende, e o que ele deliberadamente NÃO faz:
 *
 *  · A PORTA. O único chamador legítimo é o pg_cron com a chave de serviço
 *    (`requireServiceRole`). Sem essa trava, a chave publicável que vai no
 *    bundle do navegador dispararia a fila inteira de fora — o achado S04. Aqui
 *    se cobra a recusa por três caminhos: sem `Authorization`, com a chave anon
 *    e com o JWT de um usuário logado (nem admin passa: papel não é chave de
 *    serviço).
 *
 *  · O EFEITO. Recusa de verdade não mexe na fila: nenhuma linha vira "enviada"
 *    e nenhuma tentativa é gasta.
 *
 *  · O que NÃO tem teste, de propósito: chamar a function COM a chave de
 *    serviço. Hoje ela pararia em 503 por falta de credencial da Meta, mas no
 *    dia em que o token do Douglas entrar no cofre esse mesmo teste passaria a
 *    mandar WhatsApp de verdade para os corretores da homologação, a cada
 *    execução da suíte. Um teste que se torna um disparo real quando a
 *    configuração muda é pior que a ausência dele.
 */
import { test, expect, db, runTag } from "../support/fixtures";
import { mintSession } from "../support/session";
import { resolveTarget } from "../support/target";
import { userFor } from "../support/users";

const alvo = resolveTarget();
const tag = runTag();
const URL_WORKER = `${alvo.supabaseUrl}/functions/v1/notify-dispatch`;

type NotificacaoRow = { id: string; sent_at: string | null; attempts: number; last_error: string | null };

/** Retrato da fila de WhatsApp: o que uma execução indevida teria mudado. */
const filaDeWhatsapp = () =>
  db.select<NotificacaoRow>(
    "notifications?channel=eq.whatsapp&select=id,sent_at,attempts,last_error&order=created_at&limit=200",
  );

const chamar = (headers: Record<string, string>) =>
  fetch(URL_WORKER, {
    method: "POST",
    headers: { apikey: alvo.anonKey, "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ origem: `e2e ${tag}` }),
  });

test("sem Authorization o worker recusa com 401", async () => {
  const res = await chamar({});
  expect(res.status, "endpoint interno não pode aceitar chamada anônima").toBe(401);
  expect(await res.text()).toMatch(/interno/i);
});

test("a chave publicável do bundle não dispara a fila de WhatsApp", async () => {
  // Esta é a chave que qualquer visitante lê no JavaScript do app. Se ela
  // bastasse, um terceiro esvaziaria a fila de avisos da equipe pela URL.
  const res = await chamar({ Authorization: `Bearer ${alvo.anonKey}` });
  expect(res.status).toBe(401);
});

test("nem a sessão de um admin logado vale como chave de serviço", async () => {
  // Papel não é credencial de máquina: `requireServiceRole` compara o token com
  // a chave de serviço, e um JWT de usuário — mesmo de admin — não é ela.
  const { access_token } = await mintSession(userFor("admin").email);
  const res = await chamar({ Authorization: `Bearer ${access_token}` });
  expect(res.status, "JWT de usuário não pode acionar o worker de fila").toBe(401);
});

test("a recusa não gasta tentativa nem marca notificação como enviada", async () => {
  const antes = await filaDeWhatsapp();
  // Se a fila estiver vazia no alvo, o caso ainda vale: ele prova que nada
  // NASCEU da chamada recusada.
  await chamar({ Authorization: `Bearer ${alvo.anonKey}` });
  const depois = await filaDeWhatsapp();

  expect(depois.length, "a chamada recusada criou ou apagou notificação").toBe(antes.length);
  const enviadas = (linhas: NotificacaoRow[]) => linhas.filter((n) => n.sent_at).length;
  expect(enviadas(depois), "a chamada recusada marcou notificação como enviada").toBe(enviadas(antes));
  const tentativas = (linhas: NotificacaoRow[]) => linhas.reduce((s, n) => s + (n.attempts ?? 0), 0);
  expect(tentativas(depois), "a chamada recusada gastou tentativa de envio").toBe(tentativas(antes));
});
