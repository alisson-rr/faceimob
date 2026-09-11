/**
 * As duas ações da ficha que gravam em DOIS lugares — e por isso podem parar no
 * meio.
 *
 *   · Desligar = `profiles.status = 'terminated'` + bloqueio da entrada no Auth
 *     (edge function). O defeito medido: a ficha gravava DESLIGADA, a função de
 *     acesso falhava, o modal fechava mesmo assim e o botão "Desligar
 *     definitivamente" some para quem já consta desligado — a pessoa ficava
 *     fora da empresa e dentro do sistema, sem nenhum caminho para repetir.
 *   · Cadastrar = conta no Auth (edge function) + ficha (`savePerson`). A conta
 *     nasce primeiro por necessidade — só a service role cria usuário, e é o
 *     gatilho que insere a linha em `profiles` —, então a falha da segunda
 *     etapa tem de dizer que a conta JÁ existe.
 *
 * O que está mockado é só a fronteira (a edge function e `savePerson`);
 * `buildPersonSave` roda de verdade, porque é ela que decide o que vai para o
 * banco.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EMPTY_DETAILS, SavePersonError, type ProfileIdentity } from "@/integrations/supabase/people";
import { BrokerEditModal } from "@/components/BrokerEditModal";

const detalhes = vi.hoisted(() => ({ fn: vi.fn() }));
const salvar = vi.hoisted(() => ({ fn: vi.fn() }));
type Aviso = { title?: string; description?: string; variant?: string };
const toasts = vi.hoisted(() => ({ lista: [] as Aviso[] }));

vi.mock("@/integrations/supabase/people", async (original) => {
  const real = await original<typeof import("@/integrations/supabase/people")>();
  return { ...real, getPersonDetails: detalhes.fn, savePerson: salvar.fn };
});

vi.mock("@/hooks/use-toast", () => ({
  toast: (t: Aviso) => { toasts.lista.push(t); return t; },
  useToast: () => ({ toast: (t: Aviso) => { toasts.lista.push(t); } }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: "tok-de-teste" } } }) },
    storage: { from: () => ({ upload: async () => ({ error: null }), createSignedUrl: async () => ({ data: { signedUrl: "https://exemplo/x" } }) }) },
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const identidade: ProfileIdentity = {
  full_name: "Marcos Corretor",
  email: "marcos@faceimob.com.br",
  phone: "11999990000",
  avatar_url: null,
  active: true,
  status: "active",
  manager_id: null,
  director_id: null,
};

/** A ORDEM das duas gravações, na sequência em que aconteceram de verdade. */
const ordem: string[] = [];
const rede = { fn: vi.fn() };

const respostaDaFuncao = (body: unknown, ok = true) => {
  rede.fn = vi.fn(async () => {
    ordem.push("acesso");
    return { ok, status: ok ? 200 : 409, json: async () => body };
  });
  vi.stubGlobal("fetch", rede.fn);
};

const corpoEnviado = (n = 0) =>
  JSON.parse((rede.fn.mock.calls[n]?.[1] as { body: string }).body) as Record<string, unknown>;

const botao = (texto: string) => {
  const alvo = [...document.body.querySelectorAll("button")].find(b => b.textContent?.trim() === texto);
  if (!alvo) throw new Error(`botão "${texto}" não está na tela`);
  return alvo as HTMLButtonElement;
};

const campo = (rotulo: string) => {
  const alvo = [...document.body.querySelectorAll("label")].find(
    l => l.querySelector("span")?.textContent?.trim() === rotulo,
  );
  const controle = alvo?.querySelector("input");
  if (!controle) throw new Error(`campo "${rotulo}" não está na ficha`);
  return controle as HTMLInputElement;
};

const clicar = async (el: HTMLElement) => { await act(async () => { el.click(); }); };

/** Digitação em input controlado do React: o setter nativo + evento `input`. */
const digitar = async (el: HTMLInputElement, valor: string) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function montar(props: Parameters<typeof BrokerEditModal>[0]) {
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => { root?.render(<BrokerEditModal {...props} />); });
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  toasts.lista.length = 0;
  ordem.length = 0;
  detalhes.fn.mockReset();
  detalhes.fn.mockResolvedValue({ details: { ...EMPTY_DETAILS }, roles: ["broker"], identity: identidade });
  salvar.fn.mockReset();
  salvar.fn.mockImplementation(async () => { ordem.push("ficha"); });
  respostaDaFuncao({ success: true, access: "revoke", email: identidade.email, user_id: "p1", login_ready: true });
});

afterEach(async () => {
  if (root) await act(async () => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("desligamento: as duas gravações, ou a verdade sobre o que faltou", () => {
  const abrirFicha = (salvo: () => void) =>
    montar({
      open: true,
      broker: { id: "p1", name: "Marcos Corretor", login_email: identidade.email },
      managers: [], directors: [], isAdmin: true, podeMudarSituacao: true,
      onClose: () => undefined,
      onSaved: salvo,
    });

  it("bloqueio recusado: a ficha NÃO fecha e o aviso fica na tela para repetir", async () => {
    respostaDaFuncao({ error: "função indisponível" }, false);
    const salvo = vi.fn();
    await abrirFicha(salvo);

    await clicar(botao("Desligar definitivamente"));
    await clicar(botao("Desligar"));

    expect(salvar.fn.mock.calls[0][0].profile.status).toBe("terminated");
    expect(
      salvo,
      "fechar aqui esconde que ele continua entrando — e o botão de repetir some para quem já consta desligado",
    ).not.toHaveBeenCalled();
    const alerta = [...document.body.querySelectorAll('[role="alert"]')]
      .map(e => e.textContent ?? "").join(" ");
    expect(alerta, "o toast some em segundos; este é o único aviso que fica").toContain("entrada NÃO foi bloqueada");

    // E o caminho de repetição continua na tela: mesma ação, agora com a função
    // respondendo. As duas etapas são idempotentes, então repetir fecha o estado.
    respostaDaFuncao({ success: true, access: "revoke", email: identidade.email, user_id: "p1", login_ready: true });
    await clicar(botao("Desligar definitivamente"));
    await clicar(botao("Desligar"));

    expect(corpoEnviado()).toMatchObject({ profile_id: "p1", access: "revoke" });
    expect(salvo, "agora sim: ficha desligada E entrada bloqueada").toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('[role="alert"]')?.textContent ?? "")
      .not.toContain("entrada NÃO foi bloqueada");
  });

  // "desligar grava o status E bloqueia a entrada" já é cobrado em
  // `src/components/BrokerEditModal.test.tsx`; aqui fica só o que faltava —
  // o que acontece quando uma das duas gravações não vai.
});

describe("cadastro: a ficha inteira de uma vez", () => {
  const abrirCadastro = (extra: {
    onSaved?: () => void;
    onDuplicado?: (profileId: string, fullName: string) => void;
  } = {}) =>
    montar({
      open: true, broker: null, criando: true,
      managers: [], directors: [], isAdmin: true,
      onClose: () => undefined,
      onSaved: extra.onSaved ?? (() => undefined),
      onDuplicado: extra.onDuplicado,
    });

  it("cria a conta e grava a ficha digitada — nome, e-mail sugerido e CPF", async () => {
    respostaDaFuncao({ success: true, email: "ana.souza@faceimob.com.br", user_id: "novo-1", login_ready: true });
    const salvo = vi.fn();
    await abrirCadastro({ onSaved: salvo });

    await digitar(campo("Nome completo"), "Ana Souza");
    // O endereço acompanha o nome enquanto ninguém digitar outro.
    expect(campo("Email").value).toBe("ana.souza@faceimob.com.br");
    await digitar(campo("CPF"), "123.456.789-01");

    await clicar(botao("Cadastrar"));

    expect(ordem, "sem o id da conta não existe ficha para gravar").toEqual(["acesso", "ficha"]);
    expect(corpoEnviado()).toMatchObject({ email: "ana.souza@faceimob.com.br", full_name: "Ana Souza" });
    const gravado = salvar.fn.mock.calls[0][0];
    expect(gravado.id, "a ficha vai para o id que a função devolveu").toBe("novo-1");
    expect(gravado.profile.cpf, "a coluna guarda só os 11 dígitos").toBe("12345678901");
    expect(salvo).toHaveBeenCalledTimes(1);
  });

  it("e-mail já em uso abre a ficha de quem já usa o endereço, em vez de só recusar", async () => {
    respostaDaFuncao(
      { error: "Já existe um acesso com esse e-mail.", existing_profile_id: "p9", existing_full_name: "Ana Antiga" },
      false,
    );
    const duplicado = vi.fn();
    await abrirCadastro({ onDuplicado: duplicado });

    await digitar(campo("Nome completo"), "Ana Souza");
    await clicar(botao("Cadastrar"));

    expect(duplicado).toHaveBeenCalledWith("p9", "Ana Antiga");
    expect(salvar.fn, "conta não criada não pode gravar ficha nenhuma").not.toHaveBeenCalled();
  });

  it("conta criada e ficha recusada diz que a conta JÁ existe", async () => {
    // Duas etapas, uma transação nenhuma: dizer só "Falha ao cadastrar" faria o
    // admin tentar de novo achando que nada tinha acontecido.
    respostaDaFuncao({ success: true, email: "ana.souza@faceimob.com.br", user_id: "novo-1", login_ready: true });
    salvar.fn.mockRejectedValue(new SavePersonError("dados do perfil", [], new Error("CPF já cadastrado")));
    const salvo = vi.fn();
    await abrirCadastro({ onSaved: salvo });

    await digitar(campo("Nome completo"), "Ana Souza");
    await clicar(botao("Cadastrar"));

    const erro = toasts.lista.at(-1);
    expect(erro?.title).toBe("Conta criada, ficha não");
    expect(erro?.description).toContain("JÁ existe");
    expect(salvo, "ficha não gravada não pode fechar como sucesso").not.toHaveBeenCalled();
  });
});
