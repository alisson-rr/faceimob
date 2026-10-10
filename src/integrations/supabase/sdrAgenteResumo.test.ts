import { describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({ supabase: {} }));

import { camposDoTexto } from "./sdrAgenteResumo";

describe("camposDoTexto", () => {
  it("uma resposta por linha, sem marcador, vazio ou repetição", () => {
    expect(camposDoTexto("- Nome\n\n1. Unidade\n• nome\nCRECI: sim?\n")).toEqual(["Nome", "Unidade", "CRECI sim?"]);
  });
});
