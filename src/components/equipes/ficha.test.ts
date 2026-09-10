/**
 * A lógica da ficha do colaborador — a que decide o que vai para o banco.
 *
 * A ficha é o modal aberto pelo lápis desta tela (`BrokerEditModal`), e até
 * agora o que ela monta antes de gravar não tinha teste nenhum: o arquivo de
 * teste do componente não o renderiza, e a montagem morava dentro do JSX. A
 * função saiu para `people.ts` justamente para poder ser exercitada aqui.
 *
 * Os quatro casos abaixo são defeitos REAIS que já aconteceram ou que o banco
 * recusa com 42501/23514 — não hipóteses:
 *   · gravar `status` sem `terminated_at` viola `profiles_terminated_consistency`;
 *   · mandar conjunto de papéis vazio grava o perfil e só então a RPC recusa,
 *     deixando a ficha metade salva;
 *   · comparar "mudou" com o palpite da lista travava a reativação;
 *   · CPF com pontuação estoura o check `profiles_cpf_digits`.
 */
import { describe, expect, it } from "vitest";
import { EMPTY_DETAILS, buildPersonSave, type PersonFormValues } from "@/integrations/supabase/people";

const hoje = new Date().toISOString().slice(0, 10);

const form = (over: Partial<PersonFormValues> = {}): PersonFormValues => ({
  ...EMPTY_DETAILS,
  id: "p1",
  full_name: "Ana Oliveira",
  name: "Ana Oliveira",
  celular: "11999990000",
  avatar_url: null,
  active: true,
  manager_id: null,
  director_id: null,
  roles: ["broker"],
  ...over,
});

const base = { baseline: { active: true, status: "active" as const, manager_id: null, director_id: null }, isAdmin: true, managesTeam: false };

describe("buildPersonSave: validação", () => {
  it("recusa nome vazio e e-mail vazio com a frase que a tela mostra", () => {
    expect(buildPersonSave(form({ full_name: "  ", name: "" }), "a@b.com", base)).toBe("Informe o nome completo.");
    expect(buildPersonSave(form(), "  ", base)).toBe("Informe o e-mail.");
  });

  it("recusa CPF que não tem 11 dígitos (o check da coluna estouraria)", () => {
    expect(buildPersonSave(form({ cpf: "123.456" }), "a@b.com", base)).toBe("CPF precisa ter 11 dígitos.");
  });

  it("aceita CPF com pontuação e grava só os dígitos", () => {
    const out = buildPersonSave(form({ cpf: "123.456.789-01" }), "a@b.com", base);
    expect(typeof out).not.toBe("string");
    if (typeof out === "string") return;
    expect(out.profile.cpf).toBe("12345678901");
  });

  it("barra conjunto de papéis vazio ANTES de gravar o perfil", () => {
    // `set_profile_roles` recusa — mas só depois da etapa 1 de `savePerson`,
    // e o usuário ficava com uma ficha metade nova, metade antiga.
    expect(buildPersonSave(form({ roles: [] }), "a@b.com", base))
      .toBe("Escolha ao menos uma função para o colaborador.");
    // Quem não é admin não manda papel nenhum: a lista vazia é irrelevante.
    expect(typeof buildPersonSave(form({ roles: [] }), "a@b.com", { ...base, isAdmin: false })).not.toBe("string");
  });
});

describe("buildPersonSave: situação do colaborador", () => {
  const semString = (v: ReturnType<typeof buildPersonSave>) => {
    if (typeof v === "string") throw new Error(`esperava PersonSave, veio: ${v}`);
    return v;
  };

  it("não manda status quando nada mudou (mandar sempre quebrava perfil desligado)", () => {
    const out = semString(buildPersonSave(form(), "a@b.com", base));
    expect(out.profile.status).toBeUndefined();
    expect(out.profile.terminated_at).toBeUndefined();
  });

  it("suspender manda status e zera terminated_at", () => {
    const out = semString(buildPersonSave(form({ active: false }), "a@b.com", base));
    expect(out.profile.status).toBe("suspended");
    expect(out.profile.terminated_at).toBeNull();
  });

  it("desligar grava terminated + a data (o check exige os dois juntos)", () => {
    const out = semString(buildPersonSave(form(), "a@b.com", { ...base, desligar: true }));
    expect(out.profile.status).toBe("terminated");
    expect(out.profile.terminated_at).toBe(hoje);
  });

  it("reativar quem estava desligado volta a active e apaga a data", () => {
    const out = semString(buildPersonSave(
      form({ active: true }),
      "a@b.com",
      { ...base, baseline: { active: false, status: "terminated", manager_id: null, director_id: null } },
    ));
    expect(out.profile.status).toBe("active");
    expect(out.profile.terminated_at).toBeNull();
  });

  it("abrir e salvar a ficha de quem está desligado NÃO o reativa sozinho", () => {
    // O Switch abre desligado porque `active` é falso; sem tocar em nada, o
    // salvamento não pode escrever status nenhum.
    const out = semString(buildPersonSave(
      form({ active: false }),
      "a@b.com",
      { ...base, baseline: { active: false, status: "terminated", manager_id: null, director_id: null } },
    ));
    expect(out.profile.status).toBeUndefined();
  });
});

describe("buildPersonSave: o que mudou é medido contra o banco", () => {
  it("equipe só entra no payload quando o gerente escolhido é outro", () => {
    const baseline = { active: true, status: "active" as const, manager_id: "g1", director_id: null };
    const igual = buildPersonSave(form({ manager_id: "g1" }), "a@b.com", { ...base, baseline });
    const outro = buildPersonSave(form({ manager_id: "g2" }), "a@b.com", { ...base, baseline });
    if (typeof igual === "string" || typeof outro === "string") throw new Error("esperava PersonSave");
    expect(igual.managerId).toBeUndefined();
    expect(outro.managerId).toBe("g2");
  });

  it("diretor só entra quando a pessoa gerencia equipe", () => {
    const baseline = { active: true, status: "active" as const, manager_id: null, director_id: "d1" };
    const semEquipe = buildPersonSave(form({ director_id: "d2" }), "a@b.com", { ...base, baseline });
    const comEquipe = buildPersonSave(form({ director_id: "d2", roles: ["manager"] }), "a@b.com", { ...base, baseline, managesTeam: true });
    if (typeof semEquipe === "string" || typeof comEquipe === "string") throw new Error("esperava PersonSave");
    expect(semEquipe.directorId).toBeUndefined();
    expect(comEquipe.directorId).toBe("d2");
  });
});
