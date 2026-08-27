import { describe, expect, it } from "vitest";
import { resolveLink } from "./notificationLink";

describe("resolveLink", () => {
  it("reescreve /leads/<uuid> para a rota que abre o modal", () => {
    expect(resolveLink("/leads/3f1a2b4c-5d6e-7f80-9a1b-2c3d4e5f6071"))
      .toBe("/leads?lead=3f1a2b4c-5d6e-7f80-9a1b-2c3d4e5f6071");
  });

  it("deixa passar caminho interno sem reescrever", () => {
    expect(resolveLink("/pipeline")).toBe("/pipeline");
    expect(resolveLink("/leads?lead=3f1a2b4c-5d6e-7f80-9a1b-2c3d4e5f6071"))
      .toBe("/leads?lead=3f1a2b4c-5d6e-7f80-9a1b-2c3d4e5f6071");
  });

  // `notifications_insert` só cobra papel: um gerente pode gravar o link que
  // quiser no sino de qualquer perfil. Estes três são os que enganam validação
  // que só checa "começa com barra".
  it("recusa destino externo e cai no destino seguro", () => {
    expect(resolveLink("//externo.example")).toBe("/dashboard");
    expect(resolveLink("\\\\externo.example")).toBe("/dashboard");
    expect(resolveLink("https://externo.example")).toBe("/dashboard");
    expect(resolveLink("/\\externo.example")).toBe("/dashboard");
    expect(resolveLink("javascript:alert(1)")).toBe("/dashboard");
  });

  it("recusa espaco e caractere de controle, que a analise de URL remove", () => {
    // Tab, CR e LF sao REMOVIDOS na analise de URL: `/<TAB>/host` vira `//host`.
    expect(resolveLink("/\t/externo.example")).toBe("/dashboard");
    expect(resolveLink("/\r/externo.example")).toBe("/dashboard");
    expect(resolveLink("/\n/externo.example")).toBe("/dashboard");
    expect(resolveLink("/leads ?lead=1")).toBe("/dashboard");
  });
});
