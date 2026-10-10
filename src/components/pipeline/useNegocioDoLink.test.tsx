import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";
import { useNegocioDoLink } from "./useNegocioDoLink";

const ID = "11111111-2222-4333-8444-555555555555";
const h = vi.hoisted(() => ({ resolver: null as ((deals: { id: string }[]) => void) | null }));

vi.mock("@/integrations/supabase/newSchema", () => ({
  listLegacyDeals: () => new Promise((resolve) => { h.resolver = resolve; }),
}));
vi.mock("@/components/ui/sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

function Sonda({ abrir }: { abrir: (deal: LegacyDealRecord) => void }) {
  useNegocioDoLink(abrir);
  return null;
}

let root: Root;
let container: HTMLDivElement;
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe("useNegocioDoLink", () => {
  it("abre o negócio mesmo depois de tirar o ?negocio= da URL (a busca não é cancelada)", async () => {
    const abrir = vi.fn();
    container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    await act(async () => {
      root.render(<MemoryRouter initialEntries={[`/pipeline?negocio=${ID}`]}><Sonda abrir={abrir} /></MemoryRouter>);
    });
    // O parâmetro já saiu da URL; a busca responde depois.
    await act(async () => { h.resolver?.([{ id: ID }]); });
    expect(abrir).toHaveBeenCalledWith({ id: ID });
  });
});
