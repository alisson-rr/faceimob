import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  deleteAllMyPushSubscriptions: vi.fn(),
  getPushPublicKey: vi.fn(),
  listMyPushPreferences: vi.fn(),
  pushCategory: vi.fn(),
  registerPushSubscription: vi.fn(),
  setPushPreference: vi.fn(),
  unregisterPushSubscription: vi.fn(),
  sendTestPush: vi.fn(),
}));
vi.mock("@/integrations/supabase/push", () => api);

import { base64UrlToUint8Array, clearPushOnAllDevices, enablePush, getPushStatus, notifyLocally, signOutWithPush } from "./push";
import { resolveLink } from "./notificationLink";

const paraBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ELECTRON = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) faceimob/1.0 Chrome/130.0 Electron/43.0.0 Safari/537.36";

/** Propriedade própria por cima da do jsdom; `afterEach` devolve a original. */
function definir(alvo: object, nome: string, valor: unknown) {
  Object.defineProperty(alvo, nome, { value: valor, configurable: true });
}

type Ambiente = {
  ua?: string;
  permission?: NotificationPermission;
  secure?: boolean;
  standalone?: boolean;
  subscription?: { endpoint: string; unsubscribe: () => Promise<boolean> } | null;
  /** Notificações que o sw.js deixou na tela. */
  abertas?: { close: () => void }[];
};

function ambiente({ ua = CHROME, permission = "default", secure = true, standalone = false, subscription = null, abertas = [] }: Ambiente) {
  definir(navigator, "userAgent", ua);
  definir(navigator, "maxTouchPoints", 0);
  definir(window, "isSecureContext", secure);
  definir(window, "matchMedia", (query: string) => ({ matches: standalone && query.includes("standalone") }));
  const mostradas: string[] = [];
  vi.stubGlobal("Notification", class {
    static permission = permission;
    static requestPermission = vi.fn(async () => permission);
    constructor(title: string) { mostradas.push(title); }
    close() {}
  });
  vi.stubGlobal("PushManager", class {});
  definir(navigator, "serviceWorker", {
    getRegistration: vi.fn(async () => ({
      pushManager: { getSubscription: async () => subscription },
      getNotifications: async () => abertas,
    })),
  });
  return { mostradas };
}

/** Janela do app visível e focada, ou em segundo plano. */
function tela(focada: boolean) {
  definir(document, "visibilityState", focada ? "visible" : "hidden");
  definir(document, "hasFocus", () => focada);
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const nome of ["userAgent", "maxTouchPoints", "serviceWorker"]) Reflect.deleteProperty(navigator, nome);
  for (const nome of ["isSecureContext", "matchMedia"]) Reflect.deleteProperty(window, nome);
  for (const nome of ["visibilityState", "hasFocus"]) Reflect.deleteProperty(document, nome);
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("base64UrlToUint8Array", () => {
  it("troca o alfabeto url-safe e repõe o padding", () => {
    // "+/8=" em base64 comum = FB FF; base64url sem padding = "-_8".
    expect(Array.from(base64UrlToUint8Array("-_8"))).toEqual([0xfb, 0xff]);
    expect(Array.from(base64UrlToUint8Array("AQID"))).toEqual([1, 2, 3]);
  });

  it("devolve os 65 bytes de uma chave P-256 não comprimida", () => {
    const bytes = Uint8Array.from({ length: 65 }, (_, i) => (i === 0 ? 4 : i));
    const b64url = paraBase64Url(bytes);
    expect(b64url).toHaveLength(87);
    expect(base64UrlToUint8Array(b64url)).toEqual(bytes);
  });
});

describe("getPushStatus", () => {
  it("iPhone fora da Tela de Início pede instalação, não 'sem suporte'", async () => {
    ambiente({ ua: IPHONE, standalone: false });
    expect(await getPushStatus()).toBe("ios_install");
  });

  it("iPhone com o app instalado segue o fluxo normal de push", async () => {
    ambiente({ ua: IPHONE, standalone: true, permission: "default" });
    expect(await getPushStatus()).toBe("off");
  });

  it("contexto inseguro não tem push nem notificação", async () => {
    ambiente({ secure: false });
    expect(await getPushStatus()).toBe("unsupported");
  });

  it("permissão negada é bloqueado", async () => {
    ambiente({ permission: "denied" });
    expect(await getPushStatus()).toBe("blocked");
  });

  it("ligado só com permissão concedida E assinatura", async () => {
    const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/x", unsubscribe: vi.fn() };
    ambiente({ permission: "granted", subscription });
    expect(await getPushStatus()).toBe("on");
    ambiente({ permission: "granted", subscription: null });
    expect(await getPushStatus()).toBe("off");
  });

  it("Electron não usa push: cai no aviso local", async () => {
    ambiente({ ua: ELECTRON, permission: "granted" });
    expect(await getPushStatus()).toBe("local_on");
    ambiente({ ua: ELECTRON, permission: "default" });
    expect(await getPushStatus()).toBe("local_off");
  });
});

describe("signOutWithPush", () => {
  const endpoint = "https://fcm.googleapis.com/fcm/send/abc";

  it("desregistra o aparelho e fecha os avisos na tela ANTES de encerrar a sessão", async () => {
    const ordem: string[] = [];
    const aviso = { close: vi.fn(() => { ordem.push("close"); }) };
    ambiente({ permission: "granted", subscription: { endpoint, unsubscribe: vi.fn() }, abertas: [aviso] });
    api.unregisterPushSubscription.mockImplementation(async () => { ordem.push("unregister"); });
    const signOut = vi.fn(async () => { ordem.push("signOut"); return { error: null }; });

    await signOutWithPush(signOut);

    expect(api.unregisterPushSubscription).toHaveBeenCalledWith(endpoint);
    expect(ordem).toEqual(["unregister", "close", "signOut"]);
  });

  it("todos os aparelhos: devolve false quando o servidor não confirma, para a tela não encerrar as sessões", async () => {
    const unsubscribe = vi.fn(async () => true);
    ambiente({ permission: "granted", subscription: { endpoint, unsubscribe } });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    api.deleteAllMyPushSubscriptions.mockResolvedValueOnce(undefined);
    expect(await clearPushOnAllDevices()).toBe(true);

    api.deleteAllMyPushSubscriptions.mockRejectedValueOnce(new Error("timeout"));
    expect(await clearPushOnAllDevices()).toBe(false);
    // A sessão segue: a assinatura deste aparelho não é cancelada por isso.
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it("servidor fora do ar: cancela a assinatura local e sai mesmo assim", async () => {
    const unsubscribe = vi.fn(async () => true);
    ambiente({ permission: "granted", subscription: { endpoint, unsubscribe } });
    api.unregisterPushSubscription.mockRejectedValue(new Error("rede"));
    const signOut = vi.fn(async () => ({ error: null }));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await signOutWithPush(signOut);

    expect(unsubscribe).toHaveBeenCalled();
    expect(signOut).toHaveBeenCalled();
  });
});

describe("enablePush", () => {
  it("servidor recusa o registro: cancela a assinatura local e o erro sobe", async () => {
    const endpoint = "https://fcm.googleapis.com/fcm/send/abc";
    const unsubscribe = vi.fn(async () => true);
    const assinatura = {
      endpoint,
      unsubscribe,
      options: { applicationServerKey: null },
      toJSON: () => ({ endpoint, keys: { p256dh: "a".repeat(87), auth: "b".repeat(22) } }),
    };
    ambiente({ permission: "granted" });
    definir(navigator, "serviceWorker", {
      register: vi.fn(async () => ({})),
      ready: Promise.resolve({ pushManager: { getSubscription: async () => assinatura } }),
    });
    api.getPushPublicKey.mockResolvedValue(paraBase64Url(Uint8Array.from({ length: 65 }, (_, i) => (i === 0 ? 4 : i))));
    const recusa = new Error("host de push desconhecido");
    api.registerPushSubscription.mockRejectedValue(recusa);

    await expect(enablePush()).rejects.toBe(recusa);
    expect(unsubscribe).toHaveBeenCalled();
  });
});

describe("notifyLocally", () => {
  const linha = (kind: string) => ({ id: kind, kind, title: kind, channel: "in_app" });
  const CATEGORIA: Record<string, string> = {
    lead_assigned: "lead_recebido",
    lead_lost_timeout: "lead_prazo",
    comunicado: "outros",
  };

  it("onde há push não mostra nada: quem avisa é o sw.js", async () => {
    const { mostradas } = ambiente({ permission: "granted" });
    tela(false);
    await notifyLocally("perfil-push", linha("lead_assigned"), vi.fn());
    expect(mostradas).toEqual([]);
    expect(api.pushCategory).not.toHaveBeenCalled();
  });

  it("sem push segue o padrão sem linha gravada e só cala lead recebido com a janela focada", async () => {
    const { mostradas } = ambiente({ ua: ELECTRON, permission: "granted" });
    api.listMyPushPreferences.mockResolvedValue([]);
    api.pushCategory.mockImplementation(async (kind: string) => CATEGORIA[kind]);
    const avisar = async () => {
      for (const kind of Object.keys(CATEGORIA)) await notifyLocally("perfil-local", linha(kind), vi.fn());
    };

    tela(false);
    await avisar();
    expect(mostradas).toEqual(["lead_assigned", "lead_lost_timeout"]);

    mostradas.length = 0;
    tela(true);
    await avisar();
    expect(mostradas).toEqual(["lead_lost_timeout"]);
  });
});

/**
 * O sw.js é JS puro em `public/` e repete a regra de `resolveLink`. Este bloco
 * carrega o arquivo de verdade: se as duas cópias divergirem, ou a regra de
 * "app na tela não ganha notificação" quebrar, o teste reprova.
 */
describe("public/sw.js", () => {
  type Listener = (event: Record<string, unknown>) => void;

  type Janela = { url: string; visibilityState: string; focused: boolean; postMessage: () => void };
  const focada = (caminho: string, postMessage = vi.fn()): Janela =>
    ({ url: `https://app.faceimob.com.br${caminho}`, visibilityState: "visible", focused: true, postMessage });

  function carregarSw(janelas: Janela[]) {
    const listeners: Record<string, Listener> = {};
    const showNotification = vi.fn(async () => {});
    const self = {
      addEventListener: (tipo: string, fn: Listener) => { listeners[tipo] = fn; },
      clients: { matchAll: async () => janelas, claim: async () => {} },
      registration: {
        showNotification,
        pushManager: { getSubscription: async () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/x" }) },
      },
      skipWaiting: () => {},
    };
    const codigo = readFileSync(resolve(__dirname, "../../public/sw.js"), "utf8");
    const swResolveLink = new Function("self", `${codigo}\nreturn resolveLink;`)(self) as (link: unknown) => string;
    const push = async (data: unknown) => {
      let espera: Promise<unknown> = Promise.resolve();
      listeners.push({ data: { json: () => data }, waitUntil: (p: Promise<unknown>) => { espera = p; } });
      await espera;
    };
    return { swResolveLink, push, showNotification };
  }

  it("valida o link igual a resolveLink", () => {
    const { swResolveLink } = carregarSw([]);
    const casos = [
      "/leads/3f1a2b4c-5d6e-7f80-9a1b-2c3d4e5f6071",
      "/pipeline",
      "/leads?lead=3f1a2b4c-5d6e-7f80-9a1b-2c3d4e5f6071",
      "//externo.example",
      "\\\\externo.example",
      "https://externo.example",
      "/\\externo.example",
      "javascript:alert(1)",
      "/\t/externo.example",
      "",
    ];
    for (const caso of casos) expect(swResolveLink(caso)).toBe(resolveLink(caso));
    expect(swResolveLink(null)).toBe("/dashboard");
  });

  it("lead recebido com o app focado no layout logado: não mostra notificação do sistema, avisa a tela", async () => {
    const postMessage = vi.fn();
    const { push, showNotification } = carregarSw([focada("/pipeline", postMessage)]);
    await push({ id: "n1", kind: "lead_assigned", category: "lead_recebido", title: "Lead", link: "/leads" });
    expect(showNotification).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith({ type: "faceimob:push", id: "n1" });
  });

  it("app focado: o que não tem popup na tela sai sempre (prazo, e lead recebido no diário público)", async () => {
    const noPipeline = carregarSw([focada("/pipeline")]);
    await noPipeline.push({ id: "n2", kind: "lead_lost_timeout", category: "lead_prazo", title: "Prazo" });
    expect(noPipeline.showNotification).toHaveBeenCalledWith("Prazo", expect.anything());

    const noDiario = carregarSw([focada("/daily/equipe-sul")]);
    await noDiario.push({ id: "n3", kind: "lead_assigned", category: "lead_recebido", title: "Lead" });
    expect(noDiario.showNotification).toHaveBeenCalledWith("Lead", expect.anything());
  });

  it("app fora da tela: notificação urgente fica até a pessoa agir e reenvio não toca de novo", async () => {
    const { push, showNotification } = carregarSw([{ ...focada("/pipeline"), visibilityState: "hidden", focused: false }]);
    await push({ id: "n1", kind: "lead_assigned", category: "lead_recebido", title: "Lead", link: "//fora" });
    expect(showNotification).toHaveBeenCalledWith("Lead", expect.objectContaining({
      tag: "lead_recebido:n1",
      requireInteraction: true,
      data: { link: "/dashboard" },
    }));
    expect(showNotification).not.toHaveBeenCalledWith("Lead", expect.objectContaining({ renotify: true }));
  });

  it("teste sempre aparece, mesmo com o app na tela", async () => {
    const { push, showNotification } = carregarSw([focada("/settings")]);
    await push({ id: "t1", kind: "push_test", category: "outros", title: "Notificações ativadas" });
    expect(showNotification).toHaveBeenCalledWith("Notificações ativadas", expect.objectContaining({ requireInteraction: false }));
  });
});
