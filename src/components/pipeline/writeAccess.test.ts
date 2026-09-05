import { describe, expect, it } from "vitest";
import { canWriteDeals } from "./writeAccess";

describe("canWriteDeals", () => {
  // O caso que a tela errava: todo perfil carrega 'broker' desde o cadastro
  // (`handle_new_auth_user`), então `roles.includes('broker')` liberava a
  // escrita para quem só faz pré-venda, mídia ou é sócio.
  it("recusa quem carrega o broker de cadastro junto de um papel sem escrita", () => {
    expect(canWriteDeals(["sdr", "broker"])).toBe(false);
    expect(canWriteDeals(["marketing", "broker"])).toBe(false);
    expect(canWriteDeals(["partner", "broker"])).toBe(false);
  });

  it("libera quem tem papel efetivo de escrita, com ou sem o broker de cadastro", () => {
    expect(canWriteDeals(["broker"])).toBe(true);
    expect(canWriteDeals(["manager", "broker"])).toBe(true);
    expect(canWriteDeals(["director", "broker"])).toBe(true);
    expect(canWriteDeals(["cca", "broker"])).toBe(true);
    expect(canWriteDeals(["admin", "broker"])).toBe(true);
  });

  it("recusa lista vazia: é o estado de carregamento do AuthContext", () => {
    expect(canWriteDeals([])).toBe(false);
  });
});
