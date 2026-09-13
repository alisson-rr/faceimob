/*
 * Service worker do Faceimob — só notificação push.
 *
 * Não tem `fetch` de propósito: nada de cache de página ou de API. Um service
 * worker que intercepta requisição passa a servir versão velha do app depois de
 * deploy, e o problema aqui é só entregar aviso de lead com o app fechado.
 *
 * A carga vem do `push-dispatch` (contrato da 0143):
 * {"id","kind","category","title","body","link","created_at"}.
 */

/*
 * Mesma regra de `src/lib/notificationLink.ts` (`resolveLink`). Este arquivo é
 * JS puro servido de `public/` e não enxerga o bundle; `src/lib/push.test.ts`
 * carrega este arquivo e compara as duas funções para as cópias não divergirem.
 * O link da notificação vem do banco, e só caminho interno vira destino.
 */
const SAFE_LINK = "/dashboard";
const INTERNAL_PATH = /^\/(?![/\\])[A-Za-z0-9\-._~/?=&%]*$/;

function resolveLink(link) {
  if (typeof link !== "string" || !INTERNAL_PATH.test(link)) return SAFE_LINK;
  return link.replace(/^\/leads\/([0-9a-fA-F-]{36})$/, "/leads?lead=$1");
}

/** Categorias com prazo correndo: ficam na tela até a pessoa agir. */
const URGENT = ["lead_recebido", "lead_prazo"];

/*
 * Rotas fora do layout logado em `src/App.tsx` (login, troca de senha, diário
 * público): ali não há sino nem popup de lead, então janela focada nelas não
 * avisa nada sozinha. Rota pública nova no App precisa entrar aqui.
 */
const OUTSIDE_APP = /^\/(login|reset-password|daily)(\/|$)/;

const onAppScreen = (client) =>
  client.visibilityState === "visible" && client.focused && !OUTSIDE_APP.test(new URL(client.url).pathname);

const text = (value, fallback) => (typeof value === "string" && value.trim() ? value : fallback);

// Sem `fetch`, trocar de versão na hora não tem risco: não há página servida
// pelo worker antigo que possa ficar incoerente com o novo.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function readPayload(event) {
  try {
    const data = event.data ? event.data.json() : null;
    return data && typeof data === "object" ? data : {};
  } catch {
    // Carga que não é JSON ainda precisa virar notificação visível (abaixo):
    // push sem aviso na tela quebra a promessa `userVisibleOnly`.
    return {};
  }
}

/**
 * O Safari revoga a assinatura de quem recebe push e não mostra notificação
 * (webkit.org, "Meet Web Push"), sem exceção documentada para app em primeiro
 * plano. No endpoint da Apple a notificação sai sempre, mesmo com o app na tela.
 */
async function isApplePush() {
  const subscription = await self.registration.pushManager.getSubscription();
  if (!subscription) return false;
  return /(^|\.)push\.apple\.com$/.test(new URL(subscription.endpoint).hostname);
}

async function handlePush(event) {
  const data = readPayload(event);
  const kind = text(data.kind, "");
  const category = text(data.category, "outros");
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

  // Só "Lead recebido" tem aviso próprio na tela: popup e toast do
  // `NewLeadNotifier`, dentro do layout logado. Com o app focado ali, a
  // notificação do sistema seria o mesmo aviso duas vezes. Prazo, crédito e
  // atividade só sobem o número do sino, então saem sempre. O teste também
  // sai sempre: ele existe para mostrar como o aviso chega.
  if (category === "lead_recebido" && kind !== "push_test" && windows.some(onAppScreen) && !(await isApplePush())) {
    for (const client of windows) client.postMessage({ type: "faceimob:push", id: text(data.id, null) });
    return;
  }

  const urgent = URGENT.includes(category);
  await self.registration.showNotification(text(data.title, "Faceimob"), {
    body: text(data.body, ""),
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    // Um aviso por notificação (dois leads não se sobrescrevem). Sem
    // `renotify`: o `push-dispatch` guarda em `push_done_subs` os aparelhos já
    // tratados e só reenvia para os que falharam, mas o mesmo aviso ainda pode
    // chegar duas vezes aqui — timeout que o serviço de push entregou mesmo
    // assim, ou a edge que caiu antes de gravar quem recebeu. A tag igual troca
    // a notificação em silêncio, sem tocar de novo.
    tag: `${category}:${text(data.id, String(Date.now()))}`,
    requireInteraction: urgent,
    data: { link: resolveLink(data.link) },
  });
}

self.addEventListener("push", (event) => {
  event.waitUntil(handlePush(event));
});

async function openApp(link) {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const client =
    windows.find((c) => c.focused) || windows.find((c) => c.visibilityState === "visible") || windows[0];
  if (!client) return self.clients.openWindow(link);
  // `postMessage` e não `client.navigate()`: navigate recarrega a página e
  // joga fora formulário aberto. O app troca de rota pelo React Router
  // (`NotificationBell`). Janela fora do layout logado só ganha o foco.
  client.postMessage({ type: "faceimob:navigate", link });
  return client.focus();
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data;
  event.waitUntil(openApp(resolveLink(data && data.link)));
});

/*
 * Assinatura trocada pelo navegador (expirou ou foi renovada).
 *
 * Limite: o worker não tem sessão — o token do Supabase vive no localStorage da
 * página, que o service worker não lê —, então não dá para chamar
 * `register_push_subscription` daqui. O que dá é recriar a assinatura local com
 * a mesma chave; o app a registra no próximo carregamento
 * (`syncPushSubscription`, chamado no login e em cada abertura). Até lá, envio
 * para este aparelho falha e o despacho apaga o endpoint velho no 404/410.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  const options = event.oldSubscription && event.oldSubscription.options;
  if (event.newSubscription || !options || !options.applicationServerKey) return;
  event.waitUntil(
    self.registration.pushManager
      .subscribe({ userVisibleOnly: true, applicationServerKey: options.applicationServerKey })
      // Sem gesto do usuário alguns navegadores recusam; o app mostra
      // "desligado" na próxima abertura e a pessoa ativa de novo.
      .catch(() => undefined),
  );
});
