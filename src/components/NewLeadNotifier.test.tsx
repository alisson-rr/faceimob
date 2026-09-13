import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import NewLeadNotifier from "./NewLeadNotifier";

/**
 * Lead atribuído ao corretor: o diálogo mostra um lead só.
 *
 * A roleta entrega vários leads seguidos ao mesmo corretor. Trocar o diálogo
 * em silêncio sumia com o lead que estava nele, com a trava correndo. O que
 * está no prazo fica no diálogo e o seguinte vira toast; diálogo livre ou com
 * prazo vencido abre o novo sem toast repetindo a frase.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "eu" }, role: "broker", can: () => true }),
}));
// Estável como o `celebrate` real (useCallback sem dependências do EngagementLayer).
const celebrar = vi.hoisted(() => () => undefined);
vi.mock("@/components/engagement/context", () => ({ useCelebration: () => celebrar }));
vi.mock("@/integrations/supabase/leads", () => ({
  claimLead: async () => undefined,
  formatCountdown: (segundos: number) => `${segundos}s`,
}));

type Aviso = { title?: string; description?: string; action?: { label: string; onClick: () => void } };
const avisos = vi.hoisted(() => [] as Aviso[]);
vi.mock("@/hooks/use-toast", () => ({ toast: (aviso: Aviso) => { avisos.push(aviso); } }));

/** Handler que o componente registra no realtime, por evento. */
const realtime = vi.hoisted(() => new Map<string, (payload: unknown) => void>());
/** Quantas vezes o canal foi aberto e removido. */
const canal = vi.hoisted(() => ({ abertos: 0, removidos: 0 }));
vi.mock("@/integrations/supabase/client", () => {
  const channel = {
    on: (_tipo: string, filtro: { event: string }, handler: (payload: unknown) => void) => {
      realtime.set(filtro.event, handler);
      return channel;
    },
    subscribe: () => channel,
  };
  return {
    supabase: {
      channel: () => { canal.abertos += 1; return channel; },
      removeChannel: () => { canal.removidos += 1; },
    },
  };
});

const atribuido = (id: string, nome: string, prazoMs: number) => {
  const agora = new Date().toISOString();
  return {
    new: {
      id, full_name: nome, phone: null, status: "assigned", assigned_to: "eu", assigned_at: agora,
      attend_deadline: new Date(Date.now() + prazoMs).toISOString(), campaign_name: "Campanha",
      utm_source: null, form_id: null, created_at: agora, distribution_group_id: null,
    },
    commit_timestamp: agora,
  };
};

const chegou = (payload: ReturnType<typeof atribuido>) => realtime.get("UPDATE")?.(payload);
const dialogo = () => document.querySelector('[role="dialog"]')?.textContent ?? "";

async function montar() {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter><NewLeadNotifier /></MemoryRouter>); });
  return async () => {
    await act(async () => { root.unmount(); });
    container.remove();
  };
}

describe("NewLeadNotifier · lead atribuído", () => {
  afterEach(() => { avisos.length = 0; });

  it("com um lead no prazo no diálogo, o seguinte vira toast em vez de trocar o diálogo", async () => {
    const desmontar = await montar();
    // Os dois no mesmo act: chegam antes de o React aplicar o primeiro setLead.
    await act(async () => {
      chegou(atribuido("a", "Ana", 5 * 60_000));
      chegou(atribuido("b", "Bruno", 5 * 60_000));
    });
    expect(dialogo()).toContain("Ana");
    expect(avisos).toHaveLength(1);
    expect(avisos[0].title).toBe("Lead atribuído a você");
    expect(avisos[0].description).toContain("Bruno");
    await desmontar();
  });

  it("diálogo livre abre sem toast, e prazo vencido libera o diálogo para o seguinte", async () => {
    const desmontar = await montar();
    await act(async () => { chegou(atribuido("c", "Carla", -1_000)); });
    expect(dialogo()).toContain("Carla");
    await act(async () => { chegou(atribuido("d", "Diego", 5 * 60_000)); });
    expect(dialogo()).toContain("Diego");
    expect(avisos).toHaveLength(0);
    await desmontar();
  });
});

/**
 * `useNavigate` devolve função nova a cada troca de rota. Com ela nas
 * dependências do `announce`, cada clique no menu removia e reassinava o canal
 * `lead-alerts` — e um lead atribuído no intervalo não era anunciado.
 */
describe("NewLeadNotifier · troca de rota", () => {
  afterEach(() => { avisos.length = 0; });

  it("não refaz o canal, e o 'Abrir leads' do toast ainda leva a /leads", async () => {
    let navegar: ReturnType<typeof useNavigate> = () => undefined;
    let rota = "";
    function Sonda() {
      navegar = useNavigate();
      rota = useLocation().pathname;
      return null;
    }
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    await act(async () => {
      root.render(<MemoryRouter initialEntries={["/pipeline"]}><NewLeadNotifier /><Sonda /></MemoryRouter>);
    });
    const abertos = canal.abertos;
    const removidos = canal.removidos;

    await act(async () => { navegar("/equipes"); });
    await act(async () => { navegar("/atividades"); });

    expect(canal.abertos - abertos, "o canal não pode ser reaberto por troca de rota").toBe(0);
    expect(canal.removidos - removidos).toBe(0);

    await act(async () => {
      chegou(atribuido("e", "Eva", 5 * 60_000));
      chegou(atribuido("f", "Fábio", 5 * 60_000));
    });
    expect(avisos).toHaveLength(1);
    await act(async () => { avisos[0].action?.onClick(); });
    expect(rota).toBe("/leads");

    await act(async () => { root.unmount(); });
    container.remove();
  });
});
