import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IntegrationRecord } from "@/integrations/supabase/integrations";
import { INTEGRATION_SLOTS } from "@/lib/integrationCatalog";

/**
 * Quantos slots da Meta o catálogo tem HOJE. Derivado, e não um número
 * escrito à mão: a contagem já quebrou o teste quando o catálogo ganhou o
 * `whatsapp_notify_template`, e o que o caso quer provar é "um aviso por
 * slot", não "exatamente seis". Acrescentar slot novo passa a ser mudança de
 * uma linha no catálogo, sem teste vermelho de tabela.
 */
const SLOTS_META = INTEGRATION_SLOTS.filter((s) => s.provider === "meta").length;

/**
 * A tela de Meta Ads tem de dizer a verdade sobre o cofre.
 *
 * Antes o Verify Token era uma string fixa no bundle e o badge "Webhook ativo"
 * era decorativo: com o cofre vazio a tela ensinava a colar um token que a
 * function nunca aceitaria. Aqui o cofre é simulado nos dois estados e o que se
 * confere é o que o admin lê — badge, lista de slots e o token gerado.
 *
 * Renderiza com `react-dom` puro (não há testing-library no projeto) e sem
 * `act`: as atualizações assíncronas do TanStack Query são esperadas com
 * `vi.waitFor`, o mesmo que o usuário faz.
 */
const cofre = vi.hoisted(() => ({
  listIntegrations: vi.fn(),
  setIntegrationSecret: vi.fn(),
}));
vi.mock("@/integrations/supabase/integrations", () => cofre);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/**
 * A tela lê `can("settings.integrations")` — o MESMO código que guarda
 * `list_integrations` e `set_integration_secret` no banco (0044), e que é
 * diferente do `menu.admin_lead_automation` que libera a rota. Sem sessão de
 * verdade no jsdom, a permissão é injetada aqui: `true` no caso normal, `false`
 * no caso de quem só tem o menu.
 */
const sessao = vi.hoisted(() => ({ podeGravar: true }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ can: (codigo: string) => sessao.podeGravar && codigo === "settings.integrations" }),
}));

import MetaAdsSetup from "./MetaAdsSetup";

const registro = (label: string, updated_at = "2026-08-21T14:30:00.000Z"): IntegrationRecord => ({
  id: `id-${label}`,
  provider: "meta",
  label,
  active: true,
  has_secret: true,
  config: null,
  updated_at,
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function montar(linhas: IntegrationRecord[]) {
  cofre.listIntegrations.mockResolvedValue(linhas);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root.render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MetaAdsSetup />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const el = container;
  // `root.render` é assíncrono: sem o h1 montado, um container vazio também
  // "não contém Carregando" e a espera terminaria antes da primeira pintura.
  await vi.waitFor(() => {
    expect(el.querySelector("h1")).not.toBeNull();
    expect(el.textContent).not.toContain("Carregando");
  });
  return el;
}

const botao = (el: HTMLElement, rotulo: string) =>
  Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.trim() === rotulo);

afterEach(() => {
  root?.unmount();
  container?.remove();
  root = null;
  container = null;
  sessao.podeGravar = true;
  vi.clearAllMocks();
});

describe("MetaAdsSetup", () => {
  it("cofre vazio: avisa o que falta e aponta para Integrações", async () => {
    const el = await montar([]);

    expect(el.textContent).toContain("Falta credencial");
    expect(el.textContent).not.toContain("Webhook pronto");
    expect(el.textContent).toContain("O webhook ainda não valida");
    expect(el.textContent).toContain("Meta — token da página");
    // Um "Não configurado" por slot da Meta do catálogo, mais o campo Verify
    // Token que a própria tela mostra.
    expect(el.textContent?.match(/Não configurado/g)).toHaveLength(SLOTS_META + 1);
    expect(el.querySelector('a[href="/admin/integrations"]')).not.toBeNull();
    expect(botao(el, "Gerar e salvar")).toBeDefined();
    expect(botao(el, "Gerar novo")).toBeUndefined();
    // O token antigo, fixo no bundle, não pode voltar.
    expect(el.textContent).not.toContain("faceimob_meta_verify");
  });

  it("token da página + verify token no cofre: webhook pronto e data do token", async () => {
    const el = await montar([registro("page_access_token"), registro("webhook_verify_token")]);

    expect(el.textContent).toContain("Webhook pronto");
    expect(el.textContent).not.toContain("Falta credencial");
    expect(el.textContent).toMatch(/definido em \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
    expect(botao(el, "Gerar novo")).toBeDefined();
    expect(botao(el, "Gerar e salvar")).toBeUndefined();
    // WhatsApp não trava o webhook: continua listado, mas o topo não reclama.
    // Dois dos slots da Meta foram cadastrados neste caso; o resto segue vazio.
    expect(el.textContent?.match(/Não configurado/g)).toHaveLength(SLOTS_META - 2);
  });

  it("gerar e salvar grava um base64url de 32 bytes e só então mostra o valor", async () => {
    cofre.setIntegrationSecret.mockResolvedValue("novo-id");
    const el = await montar([]);

    botao(el, "Gerar e salvar")!.click();

    await vi.waitFor(() => expect(cofre.setIntegrationSecret).toHaveBeenCalledTimes(1));
    const [provider, label, token] = cofre.setIntegrationSecret.mock.calls[0] as [string, string, string];
    expect(provider).toBe("meta");
    expect(label).toBe("webhook_verify_token");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    await vi.waitFor(() => {
      const campos = Array.from(el.querySelectorAll("input")).map((i) => i.value);
      expect(campos).toContain(token);
    });
    expect(el.textContent).toContain("Copie agora");
  });

  it("falha do cofre não vira tela vazia: explica e oferece tentar de novo", async () => {
    // Falha de infraestrutura, não recusa. O 42501 saiu daqui de propósito: ele
    // tem tela própria (caso de permissão, no fim deste arquivo), porque
    // repetir a chamada devolveria a mesma recusa para sempre.
    cofre.listIntegrations.mockRejectedValueOnce(Object.assign(new Error("boom"), { db: { code: "08006" } }));
    const el = await montar([]);

    await vi.waitFor(() => expect(el.textContent).toContain("Não consegui ler o cofre"));
    expect(el.textContent).toContain("Não foi possível consultar as credenciais da integração.");
    // O erro cru do Postgres não pode ir para a tela.
    expect(el.textContent).not.toContain("boom");
    expect(botao(el, "Tentar de novo")).toBeDefined();
    // O badge do topo não pode ficar em "Verificando…" com o corpo dizendo que falhou.
    expect(el.textContent).toContain("Cofre indisponível");
    expect(el.textContent).not.toContain("Verificando cofre");
  });

  it("tentar de novo relê o cofre e mostra o esqueleto no lugar do erro", async () => {
    cofre.listIntegrations.mockRejectedValueOnce(new Error("boom"));
    const el = await montar([]);
    await vi.waitFor(() => expect(botao(el, "Tentar de novo")).toBeDefined());
    // A releitura fica pendurada: é nesse intervalo que o usuário precisa ver algo acontecer.
    let liberar!: (linhas: IntegrationRecord[]) => void;
    cofre.listIntegrations.mockReturnValueOnce(new Promise<IntegrationRecord[]>((r) => { liberar = r; }));

    botao(el, "Tentar de novo")!.click();

    // Sem dados, o TanStack volta o status a "pending": o erro dá lugar ao esqueleto
    // e o botão desmonta — por isso não há como disparar duas leituras.
    await vi.waitFor(() => expect(el.textContent).toContain("Carregando credenciais"));
    expect(el.textContent).not.toContain("Não consegui ler o cofre");
    expect(botao(el, "Tentar de novo")).toBeUndefined();
    expect(cofre.listIntegrations).toHaveBeenCalledTimes(2);

    liberar([]);
    await vi.waitFor(() => expect(el.textContent).toContain("Falta credencial"));
  });

  it("releitura falha depois de gravar não some com o token recém-gerado", async () => {
    cofre.setIntegrationSecret.mockResolvedValue("novo-id");
    const el = await montar([]);
    // A gravação deu certo; o que cai é o refetch disparado pelo invalidateQueries.
    cofre.listIntegrations.mockRejectedValueOnce(new Error("rede"));

    botao(el, "Gerar e salvar")!.click();

    await vi.waitFor(() => expect(el.textContent).toContain("Cofre indisponível"));
    const token = cofre.setIntegrationSecret.mock.calls[0][2] as string;
    expect(Array.from(el.querySelectorAll("input")).map((i) => i.value)).toContain(token);
    expect(el.textContent).toContain("Copie agora");
    // Há dados (os antigos) na tela: o vazio de erro é só para quando não há nada.
    expect(el.textContent).not.toContain("Não consegui ler o cofre");
  });

  /**
   * Quem tem só `menu.admin_lead_automation` abre esta tela e leva 42501 nas
   * duas RPCs do cofre. Antes a tela oferecia "Tentar de novo" para uma recusa
   * que nunca muda, e todos os "Salvar" habilitados para uma gravação que o
   * banco recusa — o defeito que a tela irmã (Admin · Integrações) já tratava.
   */
  it("sem a permissão do cofre: explica a recusa e não oferece repetição", async () => {
    sessao.podeGravar = false;
    cofre.listIntegrations.mockRejectedValueOnce(
      Object.assign(new Error("negado"), { db: { code: "42501" } }),
    );
    const el = await montar([]);

    await vi.waitFor(() => expect(el.textContent).toContain("Sem permissão para gerenciar integrações"));
    expect(botao(el, "Tentar de novo")).toBeUndefined();
    expect(el.textContent).not.toContain("Não consegui ler o cofre");
  });

  it("cofre legível mas sem permissão de escrita: campos em modo consulta", async () => {
    sessao.podeGravar = false;
    const el = await montar([]);

    expect(el.textContent).toContain('Sem a permissão "Gerenciar integrações"');
    // O caminho de gravação continua visível (o admin precisa saber o que falta),
    // mas desabilitado: botão que o banco recusa é pior que botão desligado.
    expect(botao(el, "Gerar e salvar")?.disabled).toBe(true);
    const senhas = Array.from(el.querySelectorAll<HTMLInputElement>('input[type="password"]'));
    expect(senhas.length).toBeGreaterThan(0);
    expect(senhas.every((i) => i.disabled)).toBe(true);
  });
});
