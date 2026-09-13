import { resolveLink } from "@/lib/notificationLink";
import { describeError } from "@/lib/supabaseError";
import {
  deleteAllMyPushSubscriptions,
  getPushPublicKey,
  listMyPushPreferences,
  pushCategory,
  registerPushSubscription,
  setPushPreference,
  unregisterPushSubscription,
  type PushCategory,
  type PushSubscriptionInput,
} from "@/integrations/supabase/push";

/**
 * Notificação push do lado do aparelho.
 *
 * Fluxo: `main.tsx` registra `/sw.js`; "Ativar" em Configurações pede a
 * permissão (só por clique), lê a chave pública do servidor, assina com
 * `userVisibleOnly` e grava o endpoint; o login ressincroniza; o logout apaga o
 * endpoint ANTES de encerrar a sessão — aparelho compartilhado não pode seguir
 * recebendo lead de quem saiu.
 *
 * Onde push não existe (Electron, que serve o app por `app://` e não tem serviço
 * de push; navegador sem `PushManager`), o sino mostra notificação do
 * sistema com o app aberto em segundo plano (`notifyLocally`).
 */

export type { PushCategory };

export const SW_URL = "/sw.js";

/**
 * Categorias da tela. `padrao` espelha o contrato da 0143 (sem linha em
 * `push_preferences` = ligado nas quatro primeiras, desligado em `outros`):
 * quem decide o envio é o banco, a tela só precisa desenhar o mesmo estado.
 */
export const PUSH_CATEGORIES: readonly { id: PushCategory; label: string; description: string; padrao: boolean }[] = [
  { id: "lead_recebido", label: "Lead recebido", description: "Lead novo chegou para você.", padrao: true },
  { id: "lead_prazo", label: "Prazo de atendimento", description: "O tempo para atender um lead está acabando.", padrao: true },
  { id: "lead_atividade", label: "Atividades do lead", description: "Tarefas e movimentações dos seus leads.", padrao: true },
  { id: "credito", label: "Crédito (CCA)", description: "Andamento das análises de crédito.", padrao: true },
  { id: "outros", label: "Outros avisos", description: "Demais comunicados do sistema.", padrao: false },
];

/**
 * - `on`/`off`: push de verdade neste aparelho (chega com o app fechado).
 * - `local_on`/`local_off`: sem push aqui; aviso do sistema só com o app aberto.
 * - `ios_install`: iPhone/iPad fora da Tela de Início — push só com o app instalado.
 */
export type PushStatus = "unsupported" | "ios_install" | "blocked" | "off" | "on" | "local_off" | "local_on";

type PushEnvironment = "push" | "local" | "ios_install" | "unsupported";

/** Erro com a frase pronta para a pessoa ler. */
export class PushSetupError extends Error {}

/** Chave VAPID base64url (sem padding) → bytes, forma que `pushManager.subscribe` aceita em todos os navegadores. */
export function base64UrlToUint8Array(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

// iPadOS se apresenta como Mac; o que o denuncia é a tela de toque.
const isIOS = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches === true ||
  ("standalone" in navigator && navigator.standalone === true);

export function pushEnvironment(): PushEnvironment {
  // No iPhone/iPad (iOS 16.4+) a API de push só existe no app aberto pela Tela
  // de Início; no Safari comum ela nem aparece, e "sem suporte" seria mentira.
  if (isIOS() && !isStandalone()) return "ios_install";
  if (!window.isSecureContext || !("Notification" in window)) return "unsupported";
  // O Electron tem `PushManager`, mas não tem serviço de push por trás (o app
  // desktop abre por `app://`); `file://` nem registra service worker.
  const push =
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    location.protocol !== "file:" &&
    !/\bElectron\//.test(navigator.userAgent);
  return push ? "push" : "local";
}

/** Chamado em `main.tsx`. Sem `fetch` no worker, registrar para todo mundo não muda nada no carregamento. */
export function registerServiceWorker(): void {
  if (pushEnvironment() !== "push") return;
  navigator.serviceWorker.register(SW_URL).catch((err) => {
    console.warn("O service worker de avisos não registrou:", err);
  });
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushEnvironment() !== "push") return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return registration ? registration.pushManager.getSubscription() : null;
}

export async function getPushStatus(): Promise<PushStatus> {
  const env = pushEnvironment();
  if (env === "unsupported" || env === "ios_install") return env;
  if (Notification.permission === "denied") return "blocked";
  if (env === "local") return Notification.permission === "granted" ? "local_on" : "local_off";
  return Notification.permission === "granted" && (await currentSubscription()) ? "on" : "off";
}

async function serverKey(): Promise<Uint8Array> {
  const value = await getPushPublicKey();
  if (!value) {
    throw new PushSetupError("O envio de avisos ainda não foi configurado no servidor. Avise um administrador da Faceimob.");
  }
  // 65 bytes (ponto P-256 não comprimido) = 87 caracteres base64url, começando em 0x04.
  const key = /^[A-Za-z0-9_-]{87}$/.test(value) ? base64UrlToUint8Array(value) : null;
  if (!key || key[0] !== 4) {
    throw new PushSetupError("A chave de avisos gravada no servidor é inválida. Avise um administrador da Faceimob.");
  }
  return key;
}

function sameKey(current: ArrayBuffer | null, key: Uint8Array): boolean {
  // Navegador que não expõe a chave da assinatura: assume a mesma. O contrário
  // trocaria o endpoint a cada abertura do app.
  if (!current) return true;
  const bytes = new Uint8Array(current);
  return bytes.length === key.length && bytes.every((b, i) => b === key[i]);
}

async function ensureSubscription(registration: ServiceWorkerRegistration, key: Uint8Array): Promise<PushSubscription> {
  const current = await registration.pushManager.getSubscription();
  if (current && sameKey(current.options.applicationServerKey, key)) return current;
  // Chave trocada no servidor: a assinatura velha só vale para a chave velha, e
  // `subscribe` com outra chave falha enquanto ela existir.
  if (current) await current.unsubscribe();
  return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
}

function subscriptionInput(subscription: PushSubscription): PushSubscriptionInput {
  const json = subscription.toJSON();
  // O banco confere 87 e 22 caracteres base64url sem padding; tirar `=` aqui
  // evita recusa se algum navegador o incluir.
  const p256dh = json.keys?.p256dh?.replace(/=+$/, "");
  const auth = json.keys?.auth?.replace(/=+$/, "");
  if (!json.endpoint || !p256dh || !auth) {
    throw new PushSetupError("O navegador devolveu uma assinatura incompleta. Recarregue a página e tente de novo.");
  }
  return { endpoint: json.endpoint, p256dh, auth, userAgent: navigator.userAgent.slice(0, 255) };
}

/** Só a partir de um clique: o pedido de permissão fora de gesto é bloqueado (Safari) ou silenciado (Chrome). */
export async function enablePush(): Promise<PushStatus> {
  const env = pushEnvironment();
  if (env === "unsupported" || env === "ios_install") return env;

  // Primeiro passo, antes de qualquer rede: o Safari só mostra o pedido
  // enquanto o gesto do clique ainda vale.
  const permission = await Notification.requestPermission();
  if (permission === "denied") return "blocked";
  if (permission !== "granted") {
    throw new PushSetupError("O pedido de permissão foi fechado sem resposta. Clique em ativar de novo e escolha “Permitir”.");
  }
  if (env === "local") return "local_on";

  const key = await serverKey();
  await navigator.serviceWorker.register(SW_URL);
  const registration = await navigator.serviceWorker.ready;
  const subscription = await ensureSubscription(registration, key);
  try {
    await registerPushSubscription(subscriptionInput(subscription));
  } catch (err) {
    // Assinatura local sem linha no servidor mostraria "ligado" e nunca
    // receberia nada. O erro original é o que sobe.
    await subscription.unsubscribe().catch(() => false);
    throw err;
  }
  return "on";
}

export async function disablePush(): Promise<PushStatus> {
  const subscription = await currentSubscription();
  if (subscription) {
    try {
      await unregisterPushSubscription(subscription.endpoint);
    } catch (err) {
      // Não impede desligar: o `unsubscribe` abaixo é o que corta a entrega. A
      // linha que sobrar no banco volta 404/410 no próximo envio e o
      // `push-dispatch` a apaga.
      console.warn("O servidor não confirmou o desligamento; a assinatura local foi cancelada:", err);
    }
    await subscription.unsubscribe();
  }
  return getPushStatus();
}

/**
 * Se este navegador já tem permissão e assinatura, grava de novo para a conta
 * logada. Cobre troca de conta no mesmo navegador (o upsert por endpoint passa
 * o aparelho para quem entrou), a assinatura renovada pelo navegador
 * (`pushsubscriptionchange` no sw.js) e a troca da chave VAPID no servidor.
 * O erro sobe: Configurações não pode dizer "ligado" sem o servidor confirmar.
 */
export async function confirmPushSubscription(): Promise<void> {
  if (pushEnvironment() !== "push" || Notification.permission !== "granted") return;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration || !(await registration.pushManager.getSubscription())) return;
  const subscription = await ensureSubscription(registration, await serverKey());
  await registerPushSubscription(subscriptionInput(subscription));
}

/** Login e cada abertura do app: `confirmPushSubscription` em segundo plano, falha só vai ao log. */
export async function syncPushSubscription(): Promise<void> {
  try {
    await confirmPushSubscription();
  } catch (err) {
    console.warn("Não foi possível ressincronizar os avisos deste aparelho:", err);
  }
}

async function leavePush(): Promise<void> {
  const registration =
    pushEnvironment() === "push" ? await navigator.serviceWorker.getRegistration().catch(() => undefined) : undefined;
  const subscription = (await registration?.pushManager.getSubscription().catch(() => null)) ?? null;
  try {
    if (subscription) await unregisterPushSubscription(subscription.endpoint);
  } catch (err) {
    // O servidor não confirmou. Cancelar a assinatura local mata o endpoint (o
    // próximo envio volta 410 e o despacho apaga a linha). E sair nunca pode
    // travar por causa de aviso.
    console.warn("Não foi possível desligar os avisos no servidor antes de sair:", err);
    await subscription?.unsubscribe().catch(() => false);
  }
  // Computador compartilhado: aviso de lead usa `requireInteraction` e fica na
  // tela até alguém clicar, com o nome do lead no título. Quem entra depois
  // não pode ver os leads de quem saiu.
  const abertas = (await registration?.getNotifications().catch(() => [])) ?? [];
  for (const notification of abertas) notification.close();
}

/**
 * Sai da conta desligando o push deste aparelho ANTES — depois do `signOut`
 * não há sessão para chamar a RPC.
 *
 * Mantém a assinatura local: quem entrar de novo neste navegador volta a
 * receber sem reativar (`syncPushSubscription`). Se a saída falhar, a sessão
 * continua, e o aparelho volta a ser registrado.
 */
export async function signOutWithPush<R extends { error: unknown }>(signOut: () => Promise<R>): Promise<R> {
  await leavePush();
  const result = await signOut();
  if (result.error) void syncPushSubscription();
  return result;
}

/**
 * Apaga as assinaturas de todos os aparelhos da conta, para troca de senha e
 * "encerrar todas as sessões". Chamar ANTES do `signOut` global: aparelho que
 * perdeu a sessão nunca mais consegue apagar a própria linha e seguiria
 * recebendo lead. Devolve `false` quando o servidor não confirmou; quem chama
 * decide se encerra as sessões mesmo assim (ver `Settings.tsx`).
 */
export async function clearPushOnAllDevices(): Promise<boolean> {
  try {
    await deleteAllMyPushSubscriptions();
    return true;
  } catch (err) {
    console.warn("Não foi possível desligar os avisos dos outros aparelhos:", err);
    return false;
  }
}

// ── aviso local (sem push) ───────────────────────────────────────────────────

let preferencesCache: { profileId: string; prefs: Promise<Map<PushCategory, boolean>> } | null = null;

function preferencesOf(profileId: string): Promise<Map<PushCategory, boolean>> {
  if (preferencesCache?.profileId !== profileId) {
    const prefs = listMyPushPreferences().then((rows) => new Map(rows.map((row) => [row.category, row.enabled])));
    preferencesCache = { profileId, prefs };
    // Falha não fica guardada: o próximo aviso tenta ler de novo.
    prefs.catch(() => {
      if (preferencesCache?.prefs === prefs) preferencesCache = null;
    });
  }
  return preferencesCache.prefs;
}

export function isCategoryOn(prefs: Map<PushCategory, boolean>, category: PushCategory): boolean {
  return prefs.get(category) ?? PUSH_CATEGORIES.find((c) => c.id === category)?.padrao ?? false;
}

/** Grava a preferência e descarta a cópia lida pelo aviso local, que vale a partir do próximo aviso. */
export async function savePushPreference(profileId: string, category: PushCategory, enabled: boolean): Promise<void> {
  await setPushPreference(profileId, category, enabled);
  preferencesCache = null;
}

/** Linha de `notifications` como o realtime entrega. */
export type IncomingNotification = {
  id?: unknown;
  kind?: unknown;
  title?: unknown;
  body?: unknown;
  link?: unknown;
  channel?: unknown;
};

/**
 * Notificação do sistema para aviso novo que chegou pelo realtime do sino, onde
 * push não existe. Nunca duplica com o push: só age no ambiente `local`, em que
 * não há como este aparelho ter assinatura. Mesmas regras do sw.js — só "Lead
 * recebido" se cala com a janela focada, porque só ele tem popup na tela; o
 * teste sai sempre — e mesmas preferências.
 */
export async function notifyLocally(
  profileId: string,
  row: IncomingNotification,
  open: (path: string) => void,
): Promise<void> {
  if (pushEnvironment() !== "local" || Notification.permission !== "granted") return;
  if (row.channel !== "in_app" || typeof row.kind !== "string" || typeof row.title !== "string") return;
  if (row.kind !== "push_test") {
    const [category, prefs] = await Promise.all([pushCategory(row.kind), preferencesOf(profileId)]);
    if (!isCategoryOn(prefs, category)) return;
    if (category === "lead_recebido" && document.visibilityState === "visible" && document.hasFocus()) return;
  }
  const link = typeof row.link === "string" ? row.link : "";
  const notification = new Notification(row.title, {
    body: typeof row.body === "string" ? row.body.slice(0, 300) : undefined,
    icon: "/icon-192.png",
    tag: typeof row.id === "string" ? row.id : undefined,
  });
  notification.onclick = () => {
    notification.close();
    window.focus();
    open(resolveLink(link));
  };
}

/** Frase para a tela. Erro do banco segue a regra de `describeError`. */
export function describePushError(err: unknown, fallback: string): string {
  if (err instanceof PushSetupError) return err.message;
  if (err instanceof DOMException) {
    if (err.name === "NotAllowedError") {
      return "O navegador não deixou ativar os avisos. Libere as notificações para este site e tente de novo.";
    }
    if (err.name === "AbortError" || err.name === "NotSupportedError" || err.name === "InvalidStateError") {
      return "O navegador não conseguiu criar a assinatura de avisos. Em janela anônima isso não funciona; no Brave, ligue “Usar serviços do Google para mensagens push” em Privacidade e segurança.";
    }
  }
  return describeError(err, fallback);
}
