import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "@/hooks/use-toast";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PersonRecord } from "@/integrations/supabase/newSchema";
import DealDetailModal from "./DealDetailModal";

/**
 * "Construtora *" recusada: UMA frase, e presa ao campo.
 *
 * O E2E `admin/pipeline-negocio` batia em `strict mode violation` procurando
 * "escolha a construtora" — dois nós casavam ao mesmo tempo na criação de um
 * negócio sem construtora:
 *
 *   · a recusa, que viajava como erro de banco falso (`P0001`) até virar o
 *     toast "Erro ao salvar · Escolha a construtora: sem ela o negócio não
 *     entra na conferência documental."; e
 *   · o placeholder do Select de empreendimento, "Escolha a construtora antes",
 *     na tela desde que o formulário abriu — nenhum negócio novo nasce com
 *     construtora.
 *
 * Duas ordens com o mesmo começo para um problema só. Este teste conta os nós
 * (não pega o primeiro) e cobra o vínculo do único que sobra com o campo:
 * `aria-invalid` no Select e `aria-describedby` apontando para a frase. Cobra
 * também o que a contagem sozinha não vê — que a frase não voltou a viajar por
 * toast, que o foco vai até o campo (a frase nasce fora da área visível de quem
 * clicou no rodapé) e que ela aparece junto da recusa de participante, e não um
 * campo obrigatório por clique.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u1" },
    isAdmin: true,
    roles: ["admin"],
    canEnterStage: () => true,
    can: () => true,
  }),
}));

vi.mock("@/components/pipeline/data", () => ({
  useCanExitStage: () => () => true,
  useSelectableBrokers: () => ({ data: [], isPending: false, error: null }),
  useDealWriteLock: () => ({ readOnly: false, reason: null, month: null }),
}));

vi.mock("@/integrations/supabase/leads", () => ({ listDeveloperProjects: async () => [] }));

/** Corretor logado: `emptyDeal` o coloca em `broker1_id`, então a cobrança de
 *  participante (que vem ANTES da construtora) já está satisfeita. */
const corretor: PersonRecord = {
  id: "u1", user_id: "u1", name: "Corretor E2E", full_name: "Corretor E2E",
  email: null, phone: null, avatar_url: null, active: true, status: "active",
  roles: ["broker"], role: "broker", team_id: null, team: "", manager_id: null, director_id: null,
};

/** Desmontagem no `afterEach`, e não no fim de cada caso: um `expect` que falha
 *  interrompe o caso, o modal daquele teste ficaria no DOM e o teste seguinte
 *  clicaria no botão errado — uma falha viraria duas, com a segunda mentindo. */
const montados: { root: Root; container: HTMLElement }[] = [];

async function abrirNovoNegocio(people: PersonRecord[] = [corretor]) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  montados.push({ root, container });
  const onSave = vi.fn(async () => undefined);
  await act(async () => {
    root.render(
      <DealDetailModal
        open
        onClose={() => undefined}
        onSave={onSave}
        people={people}
        developers={[{ id: "d1", name: "Construtora Um" }]}
        stages={[{ id: "s1", code: "incomplete", label: "Incompleto", position: 1 }]}
      />,
    );
  });
  return { onSave };
}

/** Só as folhas: contar ancestrais transformaria um nó em cinco. */
const nosComTexto = (padrao: RegExp) =>
  [...document.body.querySelectorAll("*")]
    .filter((no) => no.children.length === 0 && padrao.test(no.textContent ?? ""));

async function preencherCliente(nome: string) {
  const campo = document.body.querySelector<HTMLInputElement>('input[id$="-client"]');
  if (!campo) throw new Error("o campo de cliente sumiu do formulário");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(campo, nome);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function clicarCriar() {
  const botao = [...document.body.querySelectorAll("button")]
    .find((b) => /criar negócio/i.test(b.textContent ?? ""));
  if (!botao) throw new Error("o botão de criar sumiu do rodapé");
  await act(async () => { botao.click(); });
}

describe("DealDetailModal · negócio sem construtora", () => {
  // Cada caso lê as chamadas do toast: sem isto o veredito dependeria da ordem.
  beforeEach(() => vi.mocked(toast).mockClear());

  afterEach(async () => {
    await act(async () => { montados.forEach(({ root }) => root.unmount()); });
    montados.splice(0).forEach(({ container }) => container.remove());
  });

  it("recusa a criação com UMA frase só, e ela pertence ao campo", async () => {
    const { onSave } = await abrirNovoNegocio();
    await preencherCliente("Cliente Sem Construtora");
    await clicarCriar();

    // Nada foi gravado: a recusa acontece antes de `onSave` (é ele que chama
    // `saveLegacyDeal`), então o negócio sem construtora não chega ao banco.
    expect(onSave).not.toHaveBeenCalled();

    const frases = nosComTexto(/escolha a construtora/i);
    expect(
      frases.map((no) => no.textContent),
      "a tela repetiu a mesma ordem em dois lugares",
    ).toHaveLength(1);

    const gatilho = document.body.querySelector<HTMLElement>('[id$="-developer"]');
    expect(gatilho?.getAttribute("aria-invalid")).toBe("true");
    expect(gatilho?.getAttribute("aria-describedby")).toBe(frases[0].id);
    expect(frases[0].getAttribute("role")).toBe("alert");

    // A frase nasce ~13 campos acima do rodapé de onde partiu o clique. Sem o
    // foco no gatilho, o operador não veria nada mudar na tela e o leitor de
    // tela nada reanunciaria numa segunda tentativa.
    expect(document.activeElement).toBe(gatilho);

    // O toast era o OUTRO nó do `strict mode violation`, e o `catch` que o
    // produzia continua no arquivo: contar nós do DOM sozinho não pegaria a
    // volta dele, porque o toast é montado fora deste container.
    const emToast = vi.mocked(toast).mock.calls
      .some((args) => /escolha a construtora/i.test(JSON.stringify(args)));
    expect(emToast, "a recusa da construtora voltou a viajar por toast").toBe(false);
  });

  it("cobra construtora e participante na MESMA tentativa", async () => {
    // `people` vazio: ninguém entra em `broker1_id`, então a recusa de
    // participante (que vem antes) dispara. A da construtora precisa aparecer
    // junto — senão o operador resolve uma, clica de novo e descobre a outra.
    const { onSave } = await abrirNovoNegocio([]);
    await preencherCliente("Cliente Sem Nada");
    await clicarCriar();

    expect(onSave).not.toHaveBeenCalled();
    expect(nosComTexto(/escolha a construtora/i)).toHaveLength(1);
    const participante = vi.mocked(toast).mock.calls
      .some((args) => /corretor ou gerente/i.test(JSON.stringify(args)));
    expect(participante, "a falta de participante deixou de ser avisada").toBe(true);
  });
});
