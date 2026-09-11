import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FRASE_LIMITE_PLANOS, type Plano } from "../../../supabase/functions/meta-campaign-planner/plano";

/**
 * O planejador na aba Planejador de /marketing.
 *
 * O que não pode voltar: "Gerar plano" ligado para quem o banco recusa ou no
 * teto do dia; o "Hoje: X de 20" contando planos salvos em vez das tentativas
 * que o servidor conta (divergiam quando uma tentativa falhava); link http://
 * saindo da tela; o plano sem HOUSING ou sem o número de interesses que a Meta
 * não validou; e o "Imprimir" que não é o do navegador. A edge, a tabela e o
 * contador são simulados; mesmo recorte de `MetaAdsAccountsCard.test.tsx`
 * (`react-dom` puro, `vi.waitFor` no lugar de `act`).
 */

// O jsdom não implementa a rolagem e a captura de ponteiro que o Select do Radix
// chama ao abrir a lista (mesma limitação de `closeDialog.test.tsx`).
const proto = Element.prototype as unknown as Record<string, unknown>;
proto.scrollIntoView ??= () => undefined;
proto.hasPointerCapture ??= () => false;
proto.releasePointerCapture ??= () => undefined;

const m = vi.hoisted(() => ({
  invoke: vi.fn(),
  planos: [] as unknown[],
  tentativas: 0,
  pode: true,
  rpcs: [] as unknown[][],
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = () => {
    const q = {
      select: () => q,
      order: () => q,
      limit: () => q,
      then: (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) =>
        Promise.resolve({ data: m.planos, error: null }).then(ok, falha),
    };
    return q;
  };
  // O contador vive no servidor (0123): aqui ele só responde o valor do cenário.
  const rpc = (...a: unknown[]) => (m.rpcs.push(a), Promise.resolve({ data: m.tentativas, error: null }));
  return { supabase: { functions: { invoke: m.invoke }, from: consulta, rpc } };
});

vi.mock("@/components/leads/data", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  return {
    useDevelopers: () =>
      useQuery({
        queryKey: ["teste", "construtoras"],
        queryFn: async () => [{ id: "11111111-1111-4111-8111-111111111111", name: "Construtora Alfa" }],
      }),
    useDeveloperProjects: (developerId: string) =>
      useQuery({
        queryKey: ["teste", "empreendimentos", developerId],
        queryFn: async () => [{ id: "22222222-2222-4222-8222-222222222222", name: "Residencial Sol" }],
        enabled: Boolean(developerId),
      }),
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ can: (codigo: string) => m.pode && codigo === "marketing.meta_manage", user: { id: "u1" } }),
}));

import { MetaCampaignPlanner } from "./MetaCampaignPlanner";

const DEV = "11111111-1111-4111-8111-111111111111";

const PLANO: Plano = {
  nome: "CONSTRUTORA ALFA | RESIDENCIAL SOL | FORMULARIO",
  construtora: "Construtora Alfa",
  empreendimento: "Residencial Sol",
  objetivo: "OUTCOME_LEADS",
  categoria_especial: "HOUSING",
  publico: { localizacao: "Canoas/RS", raio_km: 15, descricao: "Quem busca o primeiro imóvel." },
  interesses: [{ id: "6003", name: "Imóveis", audiencia_min: 1000, audiencia_max: 2000 }],
  interesses_nao_validados: 2,
  interesses_aviso: null,
  textos: [1, 2, 3].map((n) => ({
    texto: `Texto ${n} do anúncio.`,
    titulo: `Título ${n}`,
    descricao: `Descrição ${n}`,
    cta: "SIGN_UP",
  })),
  titulo: "Seu apê com entrada facilitada",
  verba_sugerida: 60,
  justificativa_verba: "Cabe num teste inicial.",
  link: "https://exemplo.com.br/sol",
};

const linha = (extra: Record<string, unknown> = {}) => ({
  id: "p1",
  nome: PLANO.nome,
  padrao: "mcmv",
  formato: "imagem",
  canal: "formulario",
  verba_diaria: 50,
  link: PLANO.link,
  observacoes: null,
  plano: PLANO,
  model: "gpt-4o-mini",
  created_at: "2026-09-11T12:00:00.000Z",
  ...extra,
});

/** `functions.invoke` transforma não-2xx em erro e zera `data`: o corpo fica em `error.context`. */
const recusa = (status: number, error: string) => ({
  data: null,
  error: Object.assign(new Error("Edge Function returned a non-2xx status code"), {
    context: new Response(JSON.stringify({ error }), { status }),
  }),
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function montar() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root.render(
    <QueryClientProvider client={client}>
      <MetaCampaignPlanner />
    </QueryClientProvider>,
  );
  const el = container;
  await vi.waitFor(() => {
    expect(el.textContent).toContain("Planos salvos");
    expect(el.textContent).not.toContain("Carregando planos");
  });
  return el;
}

const botao = (rotulo: string) =>
  Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim() === rotulo);

/** O controle nomeado pelo `<label>`: acha pelo texto do rótulo, como o leitor de tela. */
function campo(el: HTMLElement, rotulo: string): HTMLElement {
  const label = Array.from(el.querySelectorAll("label")).find((l) => l.textContent?.trim() === rotulo);
  const alvo = label ? document.getElementById(label.htmlFor) : null;
  if (!alvo) throw new Error(`campo sem rótulo ligado: ${rotulo}`);
  return alvo;
}

function digitar(alvo: HTMLElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(alvo), "value")?.set;
  setter?.call(alvo, valor);
  alvo.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Escolhe uma opção de um Select do Radix pelo teclado (o clique do jsdom não abre). */
async function escolher(el: HTMLElement, rotulo: string, opcao: string) {
  const gatilho = campo(el, rotulo);
  gatilho.focus();
  gatilho.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  const item = await vi.waitFor(() => {
    const achado = Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (o) => o.textContent?.trim() === opcao,
    );
    if (!achado) throw new Error(`opção não encontrada: ${opcao}`);
    return achado;
  });
  item.click();
  await vi.waitFor(() => expect(gatilho.textContent).toContain(opcao));
}

afterEach(() => {
  root?.unmount();
  container?.remove();
  root = null;
  container = null;
  m.planos = [];
  m.tentativas = 0;
  m.pode = true;
  m.rpcs = [];
  m.invoke.mockReset();
  vi.restoreAllMocks();
});

describe("MetaCampaignPlanner", () => {
  it("sem marketing.meta_manage: Gerar plano travado, e os planos salvos continuam visíveis", async () => {
    m.pode = false;
    m.planos = [linha()];
    const el = await montar();

    expect(botao("Gerar plano")?.disabled).toBe(true);
    expect(el.textContent).toContain('Sem a permissão "Gerenciar campanhas na Meta"');
    expect(el.textContent).toContain(PLANO.nome);
    expect(m.invoke).not.toHaveBeenCalled();
  });

  it("o plano mostra HOUSING, os interesses da Meta e quantos ficaram sem validação; Imprimir é o do navegador", async () => {
    m.planos = [linha()];
    const imprimir = vi.spyOn(window, "print").mockImplementation(() => undefined);
    const el = await montar();

    const plano = document.getElementById("plano-impressao");
    expect(plano?.textContent).toContain("HOUSING");
    expect(plano?.textContent).toContain("Imóveis");
    expect(plano?.textContent).toMatch(/2 palavras de interesse ficaram sem validação/);
    expect(plano?.textContent).toContain("Sugestão da IA");
    expect(plano?.textContent).toContain(PLANO.textos[2].texto);
    // A folha de impressão deixa só o plano na página.
    expect(el.querySelector('style[media="print"]')?.textContent).toContain("#plano-impressao");

    botao("Imprimir / salvar PDF")!.click();
    expect(imprimir).toHaveBeenCalledTimes(1);
  });

  it("no teto pelo contador de tentativas do servidor, e não pelos planos salvos: botão travado e a frase do limite", async () => {
    m.tentativas = 20;
    m.planos = [linha()];
    const el = await montar();

    await vi.waitFor(() => expect(el.textContent).toContain(FRASE_LIMITE_PLANOS));
    expect(botao("Gerar plano")?.disabled).toBe(true);
    expect(el.textContent).toContain("Hoje: 20 de 20 tentativas");
    expect(m.rpcs).toContainEqual(["meta_plano_tentativas_hoje"]);
  });

  it("tentativa recusada: o 429 do servidor manda, e o contador é relido depois do erro", async () => {
    m.tentativas = 19;
    m.invoke.mockResolvedValue(recusa(429, FRASE_LIMITE_PLANOS));
    const el = await montar();
    await vi.waitFor(() => expect(el.textContent).toContain("Hoje: 19 de 20 tentativas"));

    await escolher(el, "Construtora", "Construtora Alfa");
    await escolher(el, "Padrão", "MCMV");
    digitar(campo(el, "Verba diária (R$)"), "50");
    expect(botao("Gerar plano")?.disabled).toBe(false);

    // Outra aba gastou a vigésima: a tela ainda mostra 19, o servidor já está no teto.
    m.tentativas = 20;
    botao("Gerar plano")!.click();

    await vi.waitFor(() => expect(el.querySelector('[role="alert"]')?.textContent).toBe(FRASE_LIMITE_PLANOS));
    await vi.waitFor(() => expect(el.textContent).toContain("Hoje: 20 de 20 tentativas"));
    expect(botao("Gerar plano")?.disabled).toBe(true);
    expect(m.invoke).toHaveBeenCalledTimes(1);
  });

  it("link http:// não sai da tela; com https o pedido vai com o que foi escolhido e o plano novo abre", async () => {
    m.invoke.mockResolvedValue({ data: { ok: true, plan_id: "p-novo" }, error: null });
    const el = await montar();

    await escolher(el, "Construtora", "Construtora Alfa");
    await escolher(el, "Padrão", "MCMV");
    digitar(campo(el, "Verba diária (R$)"), "50");
    const link = campo(el, "Link do imóvel (opcional)");
    digitar(link, "http://exemplo.com.br/sol");

    botao("Gerar plano")!.click();
    await vi.waitFor(() => expect(el.textContent).toContain("O link precisa começar com https://"));
    expect(m.invoke).not.toHaveBeenCalled();

    digitar(link, "https://exemplo.com.br/sol");
    m.planos = [linha({ id: "p-novo" })];
    botao("Gerar plano")!.click();

    await vi.waitFor(() => expect(m.invoke).toHaveBeenCalledTimes(1));
    expect(m.invoke).toHaveBeenCalledWith("meta-campaign-planner", {
      body: {
        developer_id: DEV,
        project_id: null,
        padrao: "mcmv",
        formato: "imagem",
        canal: "formulario",
        verba_diaria: 50,
        link: "https://exemplo.com.br/sol",
        observacoes: null,
      },
    });
    await vi.waitFor(() => expect(document.getElementById("plano-impressao")?.textContent).toContain(PLANO.nome));
    expect(el.textContent).not.toContain("O link precisa começar com https://");
  });
});
