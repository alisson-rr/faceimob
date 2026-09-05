import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));

import { isHttpUrl } from "./Links";

/**
 * Salvar "banana" gravava, e o card virava um link relativo que navegava para
 * `/banana` dentro do próprio app — link quebrado com cara de tela quebrada.
 * O mesmo formato está no check `useful_links_url_absolute` (0063).
 */
describe("isHttpUrl", () => {
  it("aceita http e https", () => {
    expect(isHttpUrl("https://servicos.receita.fazenda.gov.br/")).toBe(true);
    expect(isHttpUrl("http://intranet.local/consulta")).toBe(true);
    expect(isHttpUrl("  https://exemplo.com/doc  ")).toBe(true);
  });

  it("recusa texto solto e caminho relativo", () => {
    expect(isHttpUrl("banana")).toBe(false);
    expect(isHttpUrl("/leads")).toBe(false);
    expect(isHttpUrl("www.exemplo.com")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
  });

  // `javascript:` é URL válida para o construtor e vira execução de script no
  // clique — recusar é o motivo de a checagem olhar o protocolo, e não só o parse.
  it("recusa protocolo que não é de navegação", () => {
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
  });
});
