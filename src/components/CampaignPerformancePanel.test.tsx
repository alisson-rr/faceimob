import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CampaignResult } from "./CampaignPerformancePanel";

/**
 * O formulário de campanha, nos três pontos em que ele deixava o operador sem
 * saída ou sem resposta.
 *
 * Renderiza com `react-dom` puro e espera com `vi.waitFor`, como
 * `MetaAdsSetup.test.tsx` — não há testing-library no projeto. Os Selects do
 * Radix não são exercitados: eles montam o conteúdo em portal só quando abertos
 * e o jsdom não tem os eventos de ponteiro que o Radix escuta. O que se prova
 * aqui é o que não depende deles.
 */
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ isAdmin: true, roles: ["admin"], previewRole: null }),
}));
// O painel importa a camada de dados só para escrever; nenhum caso aqui salva,
// e o cliente real tentaria falar com a rede na importação.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn(), rpc: vi.fn(), auth: { getUser: vi.fn() } },
}));

import CampaignPerformancePanel from "./CampaignPerformancePanel";

const campanha: CampaignResult = {
  id: "c1",
  externalId: "ext-1",
  name: "Lançamento Zona Sul",
  platform: "meta",
  developerId: null,
  rawStatus: "ACTIVE",
  spend: 1000,
  dailyBudget: 200,
  lifetimeBudget: 6000,
  startsOn: "2026-09-01",
  endsOn: "2026-09-30",
  leadSourceId: null,
  syncedAt: null,
  leads: 10,
  conversions: 2,
  sales: 1,
  revenue: 500000,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeAll(() => {
  // O jsdom não implementa `scrollIntoView`, e é ele que leva a vista até o
  // campo — sem o duplo, o clique em Copiar derrubaria o caso.
  Element.prototype.scrollIntoView = vi.fn();
});

async function montar() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  root.render(
    <CampaignPerformancePanel
      rows={[campanha]}
      developers={[]}
      leadSources={[]}
      loading={false}
      onReload={vi.fn()}
    />,
  );
  const el = container;
  await vi.waitFor(() => expect(el.querySelector("table")).not.toBeNull());
  return el;
}

const porRotulo = (el: HTMLElement, rotulo: string) => {
  const label = Array.from(el.querySelectorAll("label")).find((l) => l.textContent?.trim() === rotulo);
  expect(label, `sem rótulo visível "${rotulo}"`).toBeDefined();
  const alvo = el.querySelector<HTMLElement>(`#${label!.getAttribute("for")}`);
  expect(alvo, `o rótulo "${rotulo}" não aponta para nenhum campo`).not.toBeNull();
  return alvo!;
};

const acionar = (el: HTMLElement, rotulo: string) => {
  const botao = el.querySelector<HTMLButtonElement>(`button[aria-label="${rotulo}"]`)
    ?? Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.trim() === rotulo);
  expect(botao, `sem botão "${rotulo}"`).toBeTruthy();
  botao!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
};

const digitar = (campo: HTMLElement, valor: string) => {
  const input = campo as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, valor);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

afterEach(() => {
  root?.unmount();
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

describe("CampaignPerformancePanel", () => {
  /**
   * Todo campo com rótulo VISÍVEL. Os dois `<input type=date>` renderizam
   * "dd/mm/aaaa" e nada mais: com `aria-label` sozinho eram duas caixas
   * idênticas, e os três campos de dinheiro perdiam o placeholder assim que
   * carregavam valor — três números sem dizer qual é gasto, qual é teto diário
   * e qual é verba contratada.
   */
  it("cada campo do formulário tem rótulo visível ligado ao controle", async () => {
    const el = await montar();

    for (const rotulo of [
      "ID externo da campanha",
      "Nome da campanha",
      "Plataforma da campanha",
      "Construtora da campanha",
      "Origem de lead da campanha",
      "Status da campanha",
      "Total investido (R$)",
      "Orçamento diário (R$)",
      "Verba total (R$)",
      "Início da veiculação",
      "Fim da veiculação",
    ]) {
      expect(porRotulo(el, rotulo)).toBeTruthy();
    }
  });

  /**
   * Desistir da cópia. O Cancelar só aparecia com `editing` preenchido, e
   * copiar deixa `editing` nulo: quem clicasse em Copiar na linha errada ficava
   * com onze campos preenchidos pela máquina e nenhuma saída — e a campanha
   * seguinte nasceria com a verba e o período de outra.
   */
  it("o rascunho de cópia tem saída e o Cancelar o limpa", async () => {
    const el = await montar();

    acionar(el, `Copiar ${campanha.name}`);
    await vi.waitFor(() => expect(el.textContent).toContain("Cópia de campanha (rascunho)"));
    expect((porRotulo(el, "Verba total (R$)") as HTMLInputElement).value).toBe("6000");

    acionar(el, "Cancelar");

    await vi.waitFor(() => expect(el.textContent).toContain("Cadastrar campanha"));
    expect(el.textContent).not.toContain("Cópia de campanha (rascunho)");
    expect((porRotulo(el, "ID externo da campanha") as HTMLInputElement).value).toBe("");
    expect((porRotulo(el, "Verba total (R$)") as HTMLInputElement).value).toBe("");
  });

  /**
   * A recusa aponta o campo. Antes ela era só um toast que some, com o foco
   * parado no botão Salvar: num formulário de onze campos, quem não enxerga a
   * tela inteira não descobria qual deles recusou.
   */
  it("a recusa marca o campo, mostra a frase ligada a ele e leva o foco", async () => {
    const el = await montar();

    digitar(porRotulo(el, "ID externo da campanha"), "nova-1");
    digitar(porRotulo(el, "Nome da campanha"), "Nova");
    digitar(porRotulo(el, "Início da veiculação"), "2026-09-01");
    digitar(porRotulo(el, "Fim da veiculação"), "2026-08-01");
    acionar(el, "Salvar");

    const fim = porRotulo(el, "Fim da veiculação");
    await vi.waitFor(() => expect(fim.getAttribute("aria-invalid")).toBe("true"));
    expect(document.activeElement).toBe(fim);
    // A frase fica NA TELA, ligada ao campo — o toast anuncia e some.
    const erro = el.querySelector(`#${fim.getAttribute("aria-describedby")}`);
    expect(erro?.textContent).toMatch(/fim da veiculação não pode ser antes do início/i);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Campanha não salva" }));
  });
});
