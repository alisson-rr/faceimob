import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  cpfDigits,
  suggestEmail,
  EMPTY_DETAILS,
  SavePersonError,
  type ProfileIdentity,
} from "@/integrations/supabase/people";
import { BrokerEditModal } from "./BrokerEditModal";

const fonte = readFileSync(path.resolve(__dirname, "BrokerEditModal.tsx"), "utf8");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * O modal é montado de verdade aqui.
 *
 * Antes este arquivo só tinha guardas de fonte e funções puras: nenhum `it`
 * renderizava o componente. Ficavam sem cobertura justamente os controles cujo
 * defeito é "aparece na tela e o banco recusa" — o fieldset travado em
 * `details === "failed"`, o `equipeTravada` do gerente, a guarda de conjunto de
 * papéis vazio, o Switch "Ativo", a data de entrada e o provisionamento.
 *
 * O que está mockado é só a FRONTEIRA (`getPersonDetails`/`savePerson`, o
 * cliente do Supabase e o toast). `buildPersonSave` roda de verdade: é ela que
 * decide o que vai para o banco, e é o que estes testes cobram.
 */
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
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        createSignedUrl: async () => ({ data: { signedUrl: "https://exemplo/assinada" } }),
      }),
    },
  },
}));

const identidade = (patch: Partial<ProfileIdentity> = {}): ProfileIdentity => ({
  full_name: "Marcos Gerente",
  email: "marcos@faceimob.com.br",
  phone: "11999990000",
  avatar_url: null,
  active: true,
  status: "active",
  manager_id: null,
  director_id: null,
  ...patch,
});

const MANAGERS = [{ id: "m1", name: "Marcos Gerente" }, { id: "m2", name: "Outra Gerente" }];
const DIRECTORS = [{ id: "d1", name: "Daniela Diretora" }];

async function abrir(opcoes: {
  roles?: string[];
  identity?: Partial<ProfileIdentity>;
  falha?: boolean;
  isAdmin?: boolean;
  podeMudarSituacao?: boolean;
} = {}) {
  const { roles = ["broker"], identity = {}, falha = false, isAdmin = true, podeMudarSituacao = true } = opcoes;
  detalhes.fn.mockImplementation(async () => {
    if (falha) throw new Error("perfil fora do seu acesso");
    return { details: { ...EMPTY_DETAILS }, roles, identity: identidade(identity) };
  });

  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  const salvo = vi.fn();
  await act(async () => {
    root.render(
      <BrokerEditModal
        open
        broker={{ id: "p1", name: "Marcos Gerente", login_email: "marcos@faceimob.com.br" }}
        managers={MANAGERS}
        directors={DIRECTORS}
        isAdmin={isAdmin}
        podeMudarSituacao={podeMudarSituacao}
        onClose={() => undefined}
        onSaved={salvo}
      />,
    );
  });
  // Uma volta a mais: `getPersonDetails` resolve num microtask depois do render.
  await act(async () => { await Promise.resolve(); });

  return {
    salvo,
    fechar: async () => { await act(async () => { root.unmount(); }); container.remove(); },
  };
}

/** O `<label>` do kit envolve o controle; o rótulo é o primeiro `<span>`. */
function campo(rotulo: string): HTMLElement {
  const alvo = [...document.body.querySelectorAll("label")].find(
    (l) => l.querySelector("span")?.textContent?.trim() === rotulo,
  );
  if (!alvo) throw new Error(`campo "${rotulo}" não está na ficha`);
  const controle = alvo.querySelector("input, button, textarea");
  if (!controle) throw new Error(`campo "${rotulo}" não tem controle`);
  return controle as HTMLElement;
}

function botao(texto: string | RegExp): HTMLButtonElement {
  const alvo = [...document.body.querySelectorAll("button")].find((b) =>
    typeof texto === "string" ? b.textContent?.trim() === texto : texto.test(b.textContent ?? ""),
  );
  if (!alvo) throw new Error(`botão ${texto} não está na tela`);
  return alvo as HTMLButtonElement;
}

const porId = (id: string) => document.body.querySelector<HTMLElement>(`#${id}`);

const clicar = async (el: HTMLElement | null) => {
  if (!el) throw new Error("controle ausente");
  await act(async () => { el.click(); });
};

const travado = (el: HTMLElement) => el.hasAttribute("disabled") || el.hasAttribute("data-disabled");

/**
 * A edge function de acesso, sempre stubada.
 *
 * Não é conveniência: desde que o desligamento passou a BLOQUEAR a entrada, o
 * caminho do Salvar chama a função — um teste sem stub dispararia rede de
 * verdade e o toast tardio caía no meio do teste seguinte (foi assim que este
 * arquivo pegou o vazamento na primeira execução).
 */
const chamada = { fn: vi.fn() };

const respostaDaFuncao = (body: unknown, ok = true) => {
  chamada.fn = vi.fn(async () => ({ ok, status: ok ? 200 : 409, json: async () => body }));
  vi.stubGlobal("fetch", chamada.fn);
};

/** O corpo JSON que a ficha mandou para a edge function na n-ésima chamada. */
const corpoEnviado = (n = 0) =>
  JSON.parse((chamada.fn.mock.calls[n]?.[1] as { body: string }).body) as Record<string, unknown>;

beforeEach(() => {
  toasts.lista.length = 0;
  detalhes.fn.mockReset();
  salvar.fn.mockReset();
  salvar.fn.mockResolvedValue(undefined);
  respostaDaFuncao({ success: true, email: "novo@faceimob.com.br", user_id: "p1", login_ready: true });
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("BrokerEditModal: o que a ficha mostra é o que o banco aceita", () => {
  it("ficha que não carregou trava os campos em vez de gravar vazio por cima", async () => {
    const { fechar } = await abrir({ falha: true });

    expect(document.body.textContent, "o motivo tem de ficar na tela, não só no toast")
      .toContain("Os campos ficam bloqueados");
    expect(document.body.querySelector('[role="alert"]')).toBeTruthy();
    expect(
      [...document.body.querySelectorAll("fieldset")].some((f) => f.disabled),
      "fieldset destravado grava null por cima de CPF, CRECI e telefone",
    ).toBe(true);
    expect(botao("Salvar").disabled).toBe(true);

    await fechar();
  });

  it("o gerente não pode ser tirado da própria equipe pelo campo Equipe", async () => {
    const { fechar } = await abrir({ roles: ["manager"] });

    // `team_members_one_active` é UNIQUE(profile_id) where left_at is null:
    // mandá-lo para outra equipe fecha a filiação na que ele lidera, e o
    // diretor deixa de enxergá-lo (`auth_visible_profiles`).
    expect(travado(campo("Equipe (Gerente)"))).toBe(true);
    expect(document.body.textContent).toContain("o diretor deixaria de enxergá-lo");
    // E o campo Diretor, que só vale para quem gerencia, fica LIBERADO aqui.
    expect(travado(campo("Diretor"))).toBe(false);

    await fechar();
  });

  it("quem não gerencia equipe não escolhe diretor — o vínculo vem da equipe", async () => {
    const { fechar } = await abrir({ roles: ["broker"] });

    expect(travado(campo("Diretor"))).toBe(true);
    expect(document.body.textContent).toContain("herda o diretor da equipe do gerente");

    await fechar();
  });

  it("marcar SDR desmarca Corretor e diz que desmarcou", async () => {
    const { fechar } = await abrir({ roles: ["broker"] });

    expect(porId("role-broker")?.getAttribute("data-state")).toBe("checked");
    await clicar(porId("role-sdr"));

    expect(porId("role-sdr")?.getAttribute("data-state")).toBe("checked");
    expect(
      porId("role-broker")?.getAttribute("data-state"),
      "{broker,sdr} é indistinguível de um SDR comum e a 0053 recusa o negócio depois",
    ).toBe("unchecked");
    expect(document.body.querySelector('[role="status"]')?.textContent)
      .toContain("\"Corretor\" foi desmarcado");

    await fechar();
  });

  it("desmarcar todas as funções bloqueia o Salvar ANTES de gravar meia ficha", async () => {
    const { fechar } = await abrir({ roles: ["broker"] });

    await clicar(porId("role-broker"));

    expect(botao("Salvar").disabled, "a RPC só recusa depois de a etapa 1 já ter gravado").toBe(true);
    expect(document.body.textContent).toContain("Marque ao menos uma função");
    await clicar(botao("Salvar"));
    expect(salvar.fn, "nenhuma etapa pode ter rodado").not.toHaveBeenCalled();

    await fechar();
  });

  it("o Switch de situação trava para quem o banco recusa", async () => {
    const { fechar } = await abrir({ podeMudarSituacao: false });

    const chave = porId("profile-active") as HTMLButtonElement;
    expect(chave.disabled, "profiles_guard_admin_columns levanta 42501 para os demais").toBe(true);
    expect(document.body.textContent).toContain("Só o administrador ou o gestor direto");

    await fechar();
  });

  it("a data de Entrada e o bypass de IP só existem para o administrador", async () => {
    const comAdmin = await abrir({ isAdmin: true });
    expect((campo("Entrada") as HTMLInputElement).disabled).toBe(false);
    expect(porId("profile-bypass-ip")).toBeTruthy();
    await comAdmin.fechar();

    const semAdmin = await abrir({ isAdmin: false });
    // `hired_at` cai no ramo "o próprio usuário só edita dados de contato" do
    // gatilho: o diretor SEM equipe batia nele e o Salvar inteiro falhava,
    // enquanto o diretor COM equipe gravava. Mesmo botão, dois comportamentos.
    expect((campo("Entrada") as HTMLInputElement).disabled).toBe(true);
    expect(document.body.textContent).toContain("Só o administrador altera a data de entrada");
    expect(porId("profile-bypass-ip"), "coluna que só o admin grava").toBeNull();
    await semAdmin.fechar();
  });

  it("quem não é admin não mexe em funções nem no e-mail, e o bloco de Acesso some", async () => {
    // É o caso do DIRETOR: ele recebe o lápis (`profiles_manager_update` e o
    // ramo `manages_profile` do gatilho), mas `set_profile_roles` exige admin e
    // `profiles_guard_admin_columns` recusa a coluna `email`. Controle na tela
    // que o banco recusa é botão morto.
    const { fechar } = await abrir({ isAdmin: false });

    expect((campo("Email") as HTMLInputElement).disabled).toBe(true);
    expect(document.body.textContent).toContain("só o administrador o altera");
    for (const papel of ["broker", "manager", "director", "sdr", "cca", "admin"]) {
      expect(travado(porId(`role-${papel}`)!), `função ${papel} não pode ser editável`).toBe(true);
    }
    expect(document.body.textContent).toContain("Só o administrador altera funções");
    expect(document.body.textContent, "o bloco de Acesso é do admin").not.toContain("Acesso ao sistema");

    await fechar();
  });

  it("'mudou' sai do banco: ficha de suspenso abre desligada e não regrava status à toa", async () => {
    // A lista chuta `active: true` no caminho de recuperação do 409 de e-mail
    // duplicado; quem decide é o que `getPersonDetails` trouxe.
    const { fechar } = await abrir({ identity: { active: false, status: "suspended" } });

    expect(porId("profile-active")?.getAttribute("data-state")).toBe("unchecked");
    expect(document.body.textContent).toContain("Suspenso. Reversível");

    await clicar(botao("Salvar"));

    expect(salvar.fn).toHaveBeenCalledTimes(1);
    const enviado = salvar.fn.mock.calls[0][0];
    expect(enviado.profile.status, "nada mudou: mandar status de novo é ruído").toBeUndefined();
    expect(enviado.profile.full_name).toBe("Marcos Gerente");
    expect(enviado.profile.phone, "telefone lido do banco não pode virar null").toBe("11999990000");

    await fechar();
  });

  it("reativar manda status e terminated_at juntos e devolve a entrada no login", async () => {
    const { fechar } = await abrir({ identity: { active: false, status: "terminated" } });

    expect(document.body.textContent).toContain("Reativar (hoje: desligado)");
    await clicar(porId("profile-active"));
    await clicar(botao("Salvar"));

    const enviado = salvar.fn.mock.calls[0][0];
    expect(enviado.profile.status).toBe("active");
    expect(enviado.profile.terminated_at, "profiles_terminated_consistency recusa um sem o outro").toBeNull();

    // Sem esta chamada a pessoa voltaria "ativa" e trancada do lado de fora: o
    // `ban_duration` do Auth continuaria valendo e ninguém saberia por quê.
    expect(chamada.fn).toHaveBeenCalledTimes(1);
    expect(corpoEnviado()).toMatchObject({ profile_id: "p1", access: "restore" });
    expect(toasts.lista.at(-1)?.description).toContain("volta a receber o código");

    await fechar();
  });

  it("reativar sem SMTP não promete o código de 6 dígitos", async () => {
    // O ramo `access` da função devolve `login_ready` junto: sem o SMTP do
    // Brevo o e-mail com o código NÃO sai, e "ele volta a receber o código" era
    // a única frase da ficha que garantia o que a credencial ausente impede.
    respostaDaFuncao({ success: true, access: "restore", email: "marcos@faceimob.com.br", user_id: "p1", login_ready: false });
    const { fechar } = await abrir({ identity: { active: false, status: "terminated" } });

    await clicar(porId("profile-active"));
    await clicar(botao("Salvar"));

    const aviso = toasts.lista.at(-1);
    expect(corpoEnviado()).toMatchObject({ access: "restore" });
    expect(aviso?.description).toContain("O bloqueio de entrada foi removido");
    expect(aviso?.description, "prometer o código sem SMTP é fingir sucesso")
      .not.toContain("volta a receber o código");
    expect(aviso?.description).toContain("SMTP");

    await fechar();
  });

  it("reativar um desligado é do admin — o gestor não recebe o Switch", async () => {
    // A edge function que desfaz o bloqueio recusa quem não é admin. Deixar o
    // gestor ligar o Switch marcaria a pessoa como ativa e a manteria trancada.
    const { fechar } = await abrir({
      isAdmin: false,
      podeMudarSituacao: true,
      identity: { active: false, status: "terminated" },
    });

    expect((porId("profile-active") as HTMLButtonElement).disabled).toBe(true);
    expect(document.body.textContent).toContain("isso é só do administrador");

    await fechar();
  });

  it("desligar grava o status E bloqueia a entrada na mesma ação", async () => {
    const { fechar } = await abrir();

    await clicar(botao("Desligar definitivamente"));
    expect(document.body.textContent, "o efeito no login tem de estar escrito antes do clique")
      .toContain("A ENTRADA NO LOGIN É BLOQUEADA");
    await clicar(botao("Desligar"));

    expect(salvar.fn.mock.calls[0][0].profile.status).toBe("terminated");
    expect(salvar.fn.mock.calls[0][0].profile.terminated_at).toBeTruthy();
    expect(
      corpoEnviado(),
      "sem bloquear, o desligado continua lendo os próprios leads e o diário da equipe",
    ).toMatchObject({ profile_id: "p1", access: "revoke" });
    expect(toasts.lista.at(-1)?.title).toBe("Colaborador desligado");

    await fechar();
  });

  it("desligou e o bloqueio falhou: a tela diz que ele AINDA entra", async () => {
    respostaDaFuncao({ error: "função indisponível" }, false);
    const { fechar } = await abrir();

    await clicar(botao("Desligar definitivamente"));
    await clicar(botao("Desligar"));

    const aviso = toasts.lista.at(-1);
    expect(aviso?.title, "'Colaborador desligado' aqui seria meia verdade").toBe("Ficha salva, acesso não");
    expect(aviso?.variant).toBe("destructive");
    expect(aviso?.description).toContain("entrada NÃO foi bloqueada");
    expect(aviso?.description).toContain("ainda consegue entrar");

    await fechar();
  });

  it("a etapa que falhou é dita junto com o que já ficou gravado", async () => {
    salvar.fn.mockRejectedValue(
      new SavePersonError("equipe", ["dados do perfil", "funções"], new Error("sem permissão")),
    );
    const { fechar, salvo } = await abrir();

    await clicar(botao("Salvar"));

    expect(salvo, "ficha meia salva não pode fechar como sucesso").not.toHaveBeenCalled();
    expect(toasts.lista.at(-1)?.title).toBe("Erro ao salvar");
    expect(toasts.lista.at(-1)?.description).toContain("Já foi gravado: dados do perfil, funções");

    await fechar();
  });
});

describe("BrokerEditModal: trocar o e-mail de acesso", () => {
  it("o botão só libera depois de confirmar o endereço", async () => {
    respostaDaFuncao({ success: true, email: "marcos@faceimob.com.br", user_id: "p1", login_ready: true });
    const { fechar } = await abrir();

    expect(botao(/Atualizar e-mail de acesso/).disabled, "trocar o login é um clique sem volta fácil").toBe(true);
    await clicar(botao("Confirmar"));
    expect(botao(/Atualizar e-mail de acesso/).disabled).toBe(false);

    await fechar();
  });

  it("sem SMTP a caixa verde avisa que o código de 6 dígitos NÃO sai", async () => {
    respostaDaFuncao({ success: true, email: "novo@faceimob.com.br", user_id: "p1", login_ready: false });
    const { fechar } = await abrir();

    await clicar(botao("Confirmar"));
    await clicar(botao(/Atualizar e-mail de acesso/));

    expect(document.body.textContent).toContain("novo@faceimob.com.br");
    expect(document.body.textContent, "prometer o código sem SMTP é fingir sucesso")
      .toContain("ainda NÃO sai");
    expect(toasts.lista.at(-1)?.description).toContain("só chega quando o SMTP for configurado");

    await fechar();
  });

  it("login trocado + ficha recusada diz que o login JÁ mudou, não 'Falha ao atualizar'", async () => {
    // O defeito: a edge function devolvia 200 (Auth e `profiles` já trocados) e
    // o `savePerson` seguinte estourava — a tela dizia "Falha ao atualizar o
    // acesso" com o login novo valendo e a caixa verde do e-mail novo em cima.
    respostaDaFuncao({ success: true, email: "novo@faceimob.com.br", user_id: "p1", login_ready: true });
    salvar.fn.mockRejectedValue(new SavePersonError("dados do perfil", [], new Error("CPF já cadastrado")));
    const { fechar } = await abrir();

    await clicar(botao("Confirmar"));
    await clicar(botao(/Atualizar e-mail de acesso/));

    const erro = toasts.lista.at(-1);
    expect(erro?.title).toBe("E-mail de acesso trocado, mas a ficha não foi salva");
    expect(erro?.description).toContain("O login JÁ é");
    expect(erro?.title, "dizer só 'Falha' afirma o contrário do que aconteceu")
      .not.toBe("Falha ao atualizar o acesso");

    await fechar();
  });

  it("recusa da função não deixa caixa verde na tela nem grava a ficha", async () => {
    respostaDaFuncao({ error: "Já existe um acesso com esse e-mail." }, false);
    const { fechar } = await abrir();

    await clicar(botao("Confirmar"));
    await clicar(botao(/Atualizar e-mail de acesso/));

    expect(document.body.textContent).not.toContain("Acesso do colaborador:");
    expect(toasts.lista.at(-1)?.title).toBe("Falha ao atualizar o acesso");
    expect(toasts.lista.at(-1)?.description).toContain("Já existe um acesso com esse e-mail");
    expect(salvar.fn, "acesso recusado não pode gravar o resto da ficha").not.toHaveBeenCalled();

    await fechar();
  });
});

/**
 * Guardas de fonte: os dois defeitos abaixo são de classe conhecida e voltam
 * por edição pontual, não por lógica nova.
 */
describe("BrokerEditModal: o que a ficha promete tem de ter acontecido", () => {
  it("copiar espera a área de transferência antes de mostrar o ✓", () => {
    expect(fonte).toMatch(/await navigator\.clipboard\.writeText/);
    expect(fonte, "escrita na área de transferência sem await volta a mentir o ✓")
      .not.toMatch(/(?<!await )navigator\.clipboard\.writeText/);
    expect(fonte, "e a rejeição precisa virar aviso, não unhandled promise")
      .toContain("Não foi possível copiar");
  });

  it("'mudou' é medido contra o banco, não contra o palpite da lista", () => {
    expect(fonte).toContain("baseline?.manager_id");
    expect(fonte).toContain("baseline.active");
    expect(fonte).not.toMatch(/!==\s*\(broker\?\.(manager_id|director_id)/);
    expect(fonte).not.toMatch(/form\.active\s*!==\s*broker\?\.active/);
  });
});

describe("cpfDigits", () => {
  it("tira pontuação e deixa só os dígitos, como a coluna exige", () => {
    expect(cpfDigits("123.456.789-01")).toBe("12345678901");
    expect(cpfDigits(" 123 456 789 01 ")).toBe("12345678901");
  });

  it("campo vazio ou nulo vira string vazia (grava null)", () => {
    expect(cpfDigits(null)).toBe("");
    expect(cpfDigits(undefined)).toBe("");
    expect(cpfDigits("")).toBe("");
  });
});

describe("suggestEmail", () => {
  it("monta primeiro.ultimo@faceimob.com.br sem acento", () => {
    expect(suggestEmail("José da Silva Araújo")).toBe("jose.araujo@faceimob.com.br");
  });

  it("cai no apelido quando não há nome completo e não repete nome único", () => {
    expect(suggestEmail(null, "Ana")).toBe("ana@faceimob.com.br");
    expect(suggestEmail("", "")).toBe("");
  });
});
