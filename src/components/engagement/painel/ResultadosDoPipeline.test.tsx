import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LegacyDealRecord, PersonRecord } from "@/integrations/supabase/newSchema";
import { ResultadosDoPipeline } from "./ResultadosDoPipeline";

const auth = vi.hoisted(() => ({ user: { id: "broker" }, roles: ["broker"], isAdmin: false }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const people = [
  { id: "broker", manager_id: "manager", director_id: "director", roles: ["broker"], name: "Corretor" },
  { id: "manager", director_id: "director", roles: ["manager"], name: "Gerente" },
  { id: "own", manager_id: "director", director_id: "director", roles: ["broker"], name: "Equipe própria" },
] as PersonRecord[];
const deal = (id: string, brokerId: string, extra = {}) => ({ id, client: id,
  broker1_id: brokerId, broker1: brokerId, status: "PROPOSTA", outcome: "open", deal_value: 100_000, ...extra } as LegacyDealRecord);
const deals = [deal("Cliente da gerência", "broker"), deal("Cliente da equipe própria", "own"),
  deal("Cliente externo", "other"), deal("Venda rateada", "broker", { outcome: "won", broker2_id: "other", broker1_share: 50 })];
let close = async () => {};
afterEach(async () => { await close(); });
async function render(role: string) {
  auth.user = { id: role }; auth.roles = [role]; auth.isAdmin = role === "partner";
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  const onOpen = vi.fn();
  await act(async () => root.render(<ResultadosDoPipeline deals={deals} people={people}
    period={{ from: "2026-09-01", to: "2026-09-30" }} loading={false} error={false} onOpen={onOpen} />));
  close = async () => { await act(async () => root.unmount()); container.remove(); };
  return { container, onOpen };
}

describe("Resultados e propostas por papel", () => {
  it("corretor vê só as próprias propostas e o seu rateio de VGV", async () => {
    const { container, onOpen } = await render("broker");
    expect(container.textContent).toContain("Cliente da gerência");
    expect(container.textContent).not.toContain("Cliente da equipe própria");
    expect(container.textContent).not.toContain("Cliente externo");
    expect(container.textContent).toMatch(/Seu VGV vendidoR\$\s50\.000/);
    const button = container.querySelector<HTMLButtonElement>("details button")!;
    await act(async () => button.click());
    expect(onOpen).toHaveBeenCalledWith(deals[0]);
  });

  it("gerente vê propostas da equipe sem misturar outra gerência", async () => {
    const { container } = await render("manager");
    expect(container.textContent).toContain("Sua equipe");
    expect(container.textContent).toContain("Cliente da gerência");
    expect(container.textContent).not.toContain("Cliente da equipe própria");
    expect(container.textContent).not.toContain("Cliente externo");
  });

  it("diretor vê as gerências e a equipe própria", async () => {
    const { container } = await render("director");
    expect(container.textContent).toContain("Cliente da gerência");
    expect(container.textContent).toContain("Cliente da equipe própria");
    expect(container.textContent).not.toContain("Cliente externo");
    expect(container.querySelector('[aria-label="Gerência do painel"]')).not.toBeNull();
  });
});
